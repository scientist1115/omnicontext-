FROM node:20-slim

# Python3 + pip 설치 (시뮬레이터 실행용)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node 의존성
COPY package*.json ./
RUN npm install --omit=dev

# Python 의존성 (venv에 설치 후 PATH에 추가 - Debian 최신 버전은 시스템 pip install을 막음)
COPY sim/requirements.txt ./sim/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r sim/requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

COPY . .

EXPOSE 3000
CMD ["node", "src/server.js"]
