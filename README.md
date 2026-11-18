# Evidence-Grounded Industrial FCC Agent System with Multi-Modal Retrieval

催化裂化（FCC）装置问答智能体（n8n 工作流 + RAGFlow 文档检索 + 历史实时库 + 装置模型）的工作记录，每周更新。

- `workflow/`：主线已发布版工作流导出。密钥、主机地址、webhook 路径、凭据编号均已替换为占位符，导入后需自行配置。
- `scripts/`：每次修改的构建 / 上线 / 测试脚本（`r1xxx/` 为批次号，`accept/` 为预验收评分，`tagctx/` 为位号判定试验）。脚本从本地文件读取 n8n 接口密钥，仓库里不含任何密钥。
- `reports/`：周报（修改日志）与专题报告。报告中的分数是模型评分，不是专家评分。

不包含：执行记录、回答原文、公司文档与题库、密钥与证书。
