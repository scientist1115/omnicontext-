import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import topicsRouter from './routes/topics.js';
import chatRouter from './routes/chat.js';
import { startScheduler } from './scheduler.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OmniContext 서버 작동 중' });
});

app.use('/api/topics', topicsRouter);
app.use('/api/chat', chatRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OmniContext 서버가 ${PORT}번 포트에서 실행 중`);
  startScheduler();
});
