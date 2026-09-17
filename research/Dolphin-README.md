<div align="center">
<h1>(ACL-2025) Dolphin: Moving Towards Closed-loop Auto-research through Thinking, Practice, and Feedback</h1>

[[ Paper 📓 ]](https://arxiv.org/abs/2501.03916) [[ Project Page 🚀 ]](https://alpha-innovator.github.io/Dolphin-project-page/) 
</div>

# 🔥 News
  - <p style='text-align:justify'><i>2025.06</i>: &nbsp;🎉🎉 Codes have been released.</p>
  -  <p style='text-align:justify'><i>2025.05</i>: &nbsp;🎉🎉 Please checkout our latest work NovelSeek on <a href="https://arxiv.org/abs/2505.16938">arXiv</a>, <a href="https://github.com/Alpha-Innovator/NovelSeek">Github</a>, and <a href="https://huggingface.co/U4R/GeniX">Huggingface</a>.</p>
  - <p style='text-align:justify'><i>2025.05</i>: &nbsp;🎉🎉 Congratulations: Dolphin was accepted by ACL-2025 main conference.</p>
  - <p style='text-align:justify'><i>2025.04</i>: &nbsp;🎉🎉 We release the paper of <font color="red">Dolphin</font>, a closed-loop LLM-driven framework to enhance the automation level of scientific research </p>

## Introduction

<p align="center">
  <img src="./assets/framework.png" width="99%">
</p>

Recent works demonstrate that various AI-assisted research methods can largely improve research efficiency by improving data analysis, accelerating computation, and fostering novel ideageneration. To further move towards the ultimate goal (i.e., automatic scientific research), we introduce DOLPHIN, a closed-loop LLM-driven framework to enhance the automation level of scientific research. DOLPHIN first generates novel ideas based on feedback from previous experiments and relevant papers ranked by the topic and task attributes. Then, the generated ideas can be implemented using a code template refined and debugged with
the designed exception-traceback-guided local code structure. Finally, DOLPHIN automatically analyzes the results of each idea and feeds the results back to the next round of idea generation. 

## The usage of Dolphin 🐬

- **Propose novel ideas and implement code automatically**

    | Task | Point Classfication | Image Classification | Sentiment Classification |
    | :---:| :---: | :---: | :---: |
    |Baseline | 91.0% | 81.2% | 91.0%|
    |Dolphin | 93.9% |82.0% | 92.5%|

- **Perform version updates for technologies or code**

    | Task | Code Source | Previous Score| Current Score |
    | :---:| :---: | :---: | :---: |
    |Detecting insults in social commentary | AIDE | 81.0 | 84.7 |
    |Tabular playground series dec 2021 | Kaggle | 95.3 | 96.2|
    |Jigsaw toxic comment classification | Kaggle | 94.7 | 97.2 |

## 🚀 How to use Dolphin

### Installation

```
conda create -n dolphin python=3.11
conda activate dolphin

# Install PyPI requirements
pip install -r requirements.txt
```

### Start Auto-Research using Dolphin

```shell
bash launch_dolphin.sh

# modify launch_dolphin.py line # line 189 if round > 0
# exp_base_file_list = [List your exp dir] 
```

- Note that you need to add api_key and specify the model and topic in `launch_dolphin.sh`. You can refer to the [doc](AutoAD/docs/ollama_doc.md) if you want to use self-deployed model.
- Data for Point Classfication, Image Classification, and Sentiment Classification tasks can be downloaded [here](https://drive.google.com/drive/folders/1mq1y7EWW9dgPlS26hXNa3wxL7_2vvNju?usp=sharing).

## 🤔 TODO List

- [x] Release code of Dolphin
- [ ] Support more tasks

## Citations

```
@article{yuan2025dolphin,
  title={Dolphin: Closed-loop Open-ended Auto-research through Thinking, Practice, and Feedback},
  author={Yuan, Jiakang and Yan, Xiangchao and Feng, Shiyang and Zhang, Bo and Chen, Tao and Shi, Botian and Ouyang, Wanli and Qiao, Yu and Bai, Lei and Zhou, Bowen},
  journal={arXiv preprint arXiv:2501.03916},
  year={2025}
}
```
