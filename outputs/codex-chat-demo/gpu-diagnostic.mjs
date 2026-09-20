// Fixed, tiny CUDA workload. It runs through the same sandbox as user programs.
export const gpuDiagnosticSource = `import sys, json
def report(ok, reason, **extra):
 print('WORKBENCH_GPU_RESULT=' + json.dumps(dict(ok=ok, reason=reason, python=sys.executable, **extra)), flush=True)
try:
 import torch
except ImportError:
 report(False, '目前 Python 沒有 PyTorch；請改選已安裝 GPU 套件的 Python 環境。')
 sys.exit(2)
try:
 if not torch.cuda.is_available():
  report(False, 'PyTorch 無法使用 CUDA。請確認選到 GPU 版 PyTorch，且 NVIDIA 驅動可用。', torch=torch.__version__, cuda=torch.version.cuda)
  sys.exit(3)
 device=torch.cuda.get_device_name(0)
 a=torch.ones((16,16),device='cuda')
 b=a @ a
 torch.cuda.synchronize()
 if b.device.type != 'cuda' or b.sum().item() != 4096: raise RuntimeError('GPU result validation failed')
 report(True, '已在 GPU 完成 CUDA 運算。', device=device, torch=torch.__version__, cuda=torch.version.cuda)
except SystemExit: raise
except Exception as e:
 report(False, 'CUDA 運算失敗：' + str(e)[:600])
 sys.exit(4)
`;
