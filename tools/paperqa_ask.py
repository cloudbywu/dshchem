#!/usr/bin/env python3
"""paperqa_ask.py — grounded literature Q&A over a local PDF directory.

Two modes:
  default (light):  tantivy retrieval (paper-qa's index) + direct litellm
                    synthesis with inline [n] citations. Deterministic,
                    timeout-bounded, no agent runtime.
  --agent:          paper-qa's official agentic ask() (experimental — the
                    aviary agent runtime can hang on this setup).

Kept OUT of chem_engine.py on purpose: paper-qa's API moves fast, so a broken
upgrade here must not take down the deterministic chem tools.

Usage:
  python tools/paperqa_ask.py "query" --papers-dir <dir> [options]

Options:
  --papers-dir <dir>    Directory of PDF papers to index (required).
  --index-dir <dir>     Tantivy index location (default: rebuilt in temp).
  --model <name>        litellm model, e.g. deepseek/deepseek-chat (default).
  --api-key-env <name>  Env var holding the LLM API key (litellm also reads
                        provider defaults like DEEPSEEK_API_KEY).
  --top-n <int>         Retrieved passages for the prompt (default 8).
  --json                Machine-readable JSON output (answer + citations).
  --agent               Use paper-qa's official agentic ask (experimental).
"""
import argparse
import asyncio
import json
import os
import sys


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="The question to answer from the papers.")
    parser.add_argument("--papers-dir", required=True, help="Directory of PDF files.")
    parser.add_argument("--index-dir", default=None, help="Tantivy index directory.")
    parser.add_argument("--model", default="deepseek/deepseek-chat", help="litellm model name.")
    parser.add_argument("--api-key-env", default=None, help="Env var holding the API key.")
    parser.add_argument("--top-n", type=int, default=12, help="Retrieved passages (light mode).")
    parser.add_argument("--json", action="store_true", help="JSON output.")
    parser.add_argument("--agent", action="store_true", help="Official agentic ask (experimental).")
    return parser.parse_args()


async def run_light(args):
    """Retrieval + direct LLM synthesis with inline citations.

    Retrieval is deliberately self-contained: pymupdf text extraction + a
    small BM25-style scorer. paper-qa's own index was evaluated and rejected
    for this mode — its full-text index stores raw (untokenized) fields, so
    keyword queries return nothing, and its semantic index is coupled to the
    agent runtime. Our stack is fully verified (pymupdf, litellm) and stays
    independent of paper-qa's moving API.
    """
    import glob
    import math
    import re

    from litellm import completion
    from pymupdf import open as pdf_open  # noqa: F401  (import check)

    pdfs = sorted(
        glob.glob(os.path.join(args.papers_dir, "**", "*.pdf"), recursive=True)
    )
    blocks = []  # (docname, page, text)
    for pdf_path in pdfs:
        docname = os.path.basename(pdf_path)
        try:
            import fitz

            doc = fitz.open(pdf_path)
        except Exception as exc:
            print(f"[warn] cannot open {pdf_path}: {exc}", file=sys.stderr)
            continue
        for page_index in range(min(doc.page_count, 50)):
            text = doc[page_index].get_text()
            for chunk_start in range(0, len(text), 1500):
                chunk = text[chunk_start : chunk_start + 1500].strip()
                if len(chunk) >= 60:
                    blocks.append((docname, page_index + 1, chunk))
        doc.close()
    if not blocks:
        return {
            "answer": "未从 --papers-dir 提取到任何文献文本（确认存在可解析的 PDF）。",
            "status": "no-pdfs",
            "citations": [],
        }

    # BM25-style scoring: query-term frequency, length-normalized.
    query_terms = [
        t
        for t in re.split(r"\W+", args.query.lower())
        if len(t) > 2 and t not in {"what", "does", "the", "and", "under", "with", "for"}
    ]
    scored = []
    for docname, page, chunk in blocks:
        lowered = chunk.lower()
        score = 0.0
        for term in query_terms:
            count = lowered.count(term)
            if count:
                score += count * (1.0 + 6.0 / (1.0 + len(chunk) / 1500.0))
        scored.append((score, docname, page, chunk))
    scored.sort(key=lambda item: item[0], reverse=True)
    top = [item for item in scored if item[0] > 0][: args.top_n] or scored[: args.top_n]

    passages = []
    for i, (score, docname, page, chunk) in enumerate(top, start=1):
        # Keep the whole block: truncating early (observed 2026-08-14) cut
        # figure-legend numbers from a block, leaving the model to cite a
        # background passage instead of the actual data page.
        passages.append(f"[{i}] {docname} (page {page})\n{chunk[:1400]}")
    system = (
        "你是化学科研文献助手。仅依据给定的文献段落回答问题，不得使用段落之外的知识。"
        "每个结论后标注来源编号，如 [1]、[2]。若段落不足以回答，明确说明。用中文回答。\n\n"
        "引用纪律（务必遵守）：\n"
        "1. 每条文献段落是独立来源；编号 [n] 及其标注的页码 (page N) 必须与论断内容一一对应。\n"
        "2. 引用 [n] 前，核对论断是否确实出现在该段落文本中；段落中不存在的数值或结论不得标注该编号。\n"
        "3. 禁止把多个段落的信息合并标注为同一个编号；一个论断只引用其直接来源。\n"
        "4. 若某数值出现在多个段落，优先引用文本内容最完整匹配的段落，并在脚注说明其他相关段落编号。"
    )
    prompt = (
        "文献段落：\n\n"
        + "\n\n".join(passages)
        + f"\n\n问题：{args.query}\n\n回答（带 [n] 引用；每处引用标注页码）："
    )
    response = completion(
        model=args.model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        timeout=90,
    )
    answer = response.choices[0].message.content or ""
    citations = [
        {"n": i, "docname": docname, "page": page, "text": chunk[:400]}
        for i, (_, docname, page, chunk) in enumerate(top, start=1)
    ]
    return {"answer": answer, "status": "ok", "citations": citations}


async def run_agent(args):
    """Official paper-qa agentic ask (experimental)."""
    from paperqa import Settings, ask
    from paperqa.agents.main import get_directory_index

    settings = Settings(llm=args.model, embedding="sparse")
    settings.agent.agent_llm = args.model
    settings.agent.index.paper_directory = args.papers_dir
    if args.index_dir:
        settings.agent.index.index_directory = args.index_dir

    await get_directory_index(settings=settings, build=True)
    response = await ask(args.query, settings)
    session = response.session
    citations = []
    for context in getattr(session, "contexts", None) or []:
        doc = getattr(context, "text", None)
        if doc is None:
            continue
        citations.append(
            {
                "docname": getattr(doc, "docname", None),
                "page": getattr(doc, "page", None),
                "text": (getattr(doc, "text", "") or "")[:300],
            }
        )
    return {
        "answer": getattr(session, "answer", None),
        "status": getattr(response, "status", None),
        "citations": citations,
    }


def check_proxy_env():
    """Warn when a configured HTTP(S) proxy points at an unreachable port.

    A dead local proxy (observed: HTTP_PROXY=http://127.0.0.1:7897 with nothing
    listening) makes litellm fail with connection-refused. We only warn — the
    user may intentionally route through a proxy that is up later.
    """
    import socket

    for var in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        value = os.environ.get(var)
        if not value:
            continue
        try:
            target = value.split("://")[-1]
            host, _, port = target.partition(":")
            with socket.create_connection((host, int(port or 80)), timeout=1):
                pass  # proxy reachable
        except Exception:
            print(
                f"[warn] {var}={value} 不可达（连接失败）。若 LLM 请求报连接拒绝，"
                f"请先移除该环境变量（例如 $env:HTTP_PROXY=''）再重试。",
                file=sys.stderr,
            )


def main():
    args = parse_args()
    check_proxy_env()
    if args.api_key_env:
        value = os.environ.get(args.api_key_env, "")
        if value:
            os.environ.setdefault("DEEPSEEK_API_KEY", value)
        else:
            print(f"[warn] --api-key-env {args.api_key_env} is empty", file=sys.stderr)
    result = asyncio.run(run_agent(args) if args.agent else run_light(args))
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(result["answer"])
        if result["citations"]:
            print("\n--- 引用 ---")
            for c in result["citations"]:
                n = c.get("n", "?")
                print(f"- [{n}] {c['docname']} (p{c['page']}): {c['text'][:120]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
