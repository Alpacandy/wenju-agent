/**
 * exactKernelWorker —— Pyodide + SymPy 符号内核 Worker（P1 数学真底 · 锁定版本）
 *
 * 职责：在 Web Worker 内运行 SymPy，提供超越 RationalCore 的符号能力
 *（无理/复特征根的精确根式、对角化判定、任意阶精确运算）。
 *
 * 版本锁定（教学领域合同：内核版本写入实验记录，禁止浮动）：
 *   PYODIDE_VERSION = 'v0.28.3'，SymPy 1.13.3（随该版官方 CDN wheel 分发）
 *
 * 互操作契约（2026-10-11 真机修复）：JS↔Python 一律走 **JSON 字符串桥**——
 * 早期实现直接传 JS 数组/对象（PyProxy 语义歧义导致符号调用实际抛错、被错误地
 * 降级显示为 RationalCore 结果），现全部显式 JSON 序列化，杜绝隐式类型转换。
 *
 * 消息协议：{id, op, args} → {id, ok, result|error}；init 完成发 {type:'ready', kernel, version}
 */
'use strict';

const PYODIDE_VERSION = 'v0.28.3';
const SYMPY_VERSION = '1.13.3';

let pyodideReady = null;

async function ensurePyodide() {
  if (pyodideReady) return pyodideReady;
  pyodideReady = (async () => {
    // 必须使用 /pyodide/ CDN 路径（npm 镜像不含 wheels，Pyodide 官方文档约定）
    importScripts('https://cdn.jsdelivr.net/pyodide/' + PYODIDE_VERSION + '/full/pyodide.js');
    const pyodide = await loadPyodide();
    await pyodide.loadPackage('sympy');
    return pyodide;
  })();
  return pyodideReady;
}

/** 精确定义区（JSON 入口/出口，全部字符串化；函数名 __wenju_* 防命名污染） */
const PY_BOOTSTRAP = `
import json as __wenju_json
from sympy import Matrix, Rational, Symbol

def __wenju_num(v):
    s = str(v)
    try:
        return Rational(s)
    except Exception:
        return Rational(float(s))

def __wenju_analyze(rows, ops):
    rows = [[__wenju_num(x) for x in row] for row in rows]
    A = Matrix(rows)
    out = {}
    if 'det' in ops: out['det'] = str(A.det())
    if 'rank' in ops: out['rank'] = int(A.rank())
    if 'trace' in ops: out['trace'] = str(A.trace())
    if 'inverse' in ops:
        try: out['inverse'] = [[str(y) for y in row] for row in A.inv()]
        except Exception: out['inverse'] = None
    if 'nullBasis' in ops:
        out['nullBasis'] = [[str(y) for y in vec] for vec in A.nullspace()]
    if 'eigen' in ops:
        vals = A.eigenvals()
        flat = []
        for k in vals.keys():
            for _ in range(vals[k]):
                flat.append(str(k))
        out['eigenvalues'] = sorted(flat)
        try:
            P, D = A.diagonalize()
            out['diagonalizable'] = True
        except Exception:
            out['diagonalizable'] = False
    if 'charpoly' in ops:
        lam = Symbol('lam')
        out['charpoly'] = str(A.charpoly(lam).as_expr().expand())
    return out

def __wenju_analyze_entry(rows_json, ops_json):
    return __wenju_json.dumps(__wenju_analyze(__wenju_json.loads(rows_json), __wenju_json.loads(ops_json)))
`;

async function handleAnalyze(args) {
  const py = await ensurePyodide();
  await py.runPythonAsync(PY_BOOTSTRAP);
  const rowsJson = JSON.stringify(args.elements || []);
  const opsJson = JSON.stringify(args.ops || ['det', 'rank', 'trace', 'eigen', 'charpoly']);
  py.globals.set('__wenju_rows_json', rowsJson);
  py.globals.set('__wenju_ops_json', opsJson);
  const resultJson = py.runPython('__wenju_analyze_entry(__wenju_rows_json, __wenju_ops_json)');
  const result = JSON.parse(String(resultJson));
  return { ...result, kernel: 'sympy', version: SYMPY_VERSION, pyodide: PYODIDE_VERSION };
}

self.onmessage = async (ev) => {
  const { id, op, args } = ev.data || {};
  try {
    let result;
    if (op === 'analyze') result = await handleAnalyze(args || {});
    else throw new Error('未知 op: ' + op);
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String((e && e.message) || e) });
  }
};

// 启动即预热加载（不阻塞 ready 通知之后的首个请求）
ensurePyodide()
  .then(() => self.postMessage({ type: 'ready', kernel: 'sympy', version: SYMPY_VERSION, pyodide: PYODIDE_VERSION }))
  .catch((e) => self.postMessage({ type: 'unavailable', error: String((e && e.message) || e) }));
