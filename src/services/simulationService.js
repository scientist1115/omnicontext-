import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIM_SCRIPT = path.join(__dirname, '../../sim/simulate.py');

/**
 * Python 시뮬레이터를 실행합니다.
 * @param {{domain: string, params: object}} spec
 * @returns {Promise<object>} 시뮬레이션 결과 (또는 {error: string})
 */
export function runSimulation(spec) {
  return new Promise((resolve) => {
    const py = spawn('python3', [SIM_SCRIPT]);
    let stdout = '';
    let stderr = '';

    py.stdout.on('data', (d) => (stdout += d.toString()));
    py.stderr.on('data', (d) => (stderr += d.toString()));

    py.on('close', (code) => {
      if (code !== 0 && !stdout) {
        resolve({ error: stderr || `시뮬레이터가 코드 ${code}로 종료됨` });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        resolve({ error: `시뮬레이터 출력 파싱 실패: ${stdout} ${stderr}` });
      }
    });

    py.on('error', (err) => {
      resolve({ error: `Python 실행 실패 (python3가 설치되어 있는지 확인하세요): ${err.message}` });
    });

    py.stdin.write(JSON.stringify(spec));
    py.stdin.end();
  });
}
