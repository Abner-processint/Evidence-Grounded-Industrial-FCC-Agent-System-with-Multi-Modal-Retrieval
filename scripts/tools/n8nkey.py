# -*- coding: utf-8 -*-
"""从项目目录 N8N_API_KEY.txt 读出 n8n 接口密钥放进本进程环境变量，不打印。python n8nkey.py 只自检是否可用。"""
import os, io
_P = r"<USER_HOME>\Desktop\processint\N8N_API_KEY.txt"
k = io.open(_P, encoding='utf-8').read().strip()
if k: os.environ["N8N_API_KEY"] = k
if __name__ == '__main__': print('key ok' if os.environ.get("N8N_API_KEY") else 'key missing')
