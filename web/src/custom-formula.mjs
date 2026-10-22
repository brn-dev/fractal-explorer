// A small expression language shared by the CPU interpreter and WGSL generator.
// User text is parsed into an allowlisted tree; it is never executed as JS/WGSL.
export const DEFAULT_FORMULA = 'z^2 + c';
export const MAX_FORMULA_LENGTH = 1024;
const functions = new Set(['ln', 'log', 'exp', 'sqrt', 'sin', 'cos', 'tan', 'sinh', 'cosh', 'abs', 'conj', 're', 'im', 'pow']);
const cache = new Map();

export function parseFormula(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Enter a recurrence, for example z^2 + c.');
  if (source.length > MAX_FORMULA_LENGTH) throw new Error(`Use at most ${MAX_FORMULA_LENGTH} characters in the recurrence.`);
  let position = 0, nodes = 0, depth = 0;
  const fail = message => { throw new Error(`${message} (column ${position + 1}).`); };
  const space = () => { while (/\s/.test(source[position] ?? '') && position < source.length) position++; };
  const take = token => { space(); if (source.startsWith(token, position)) { position += token.length; return true; } return false; };
  const node = (op, ...args) => {
    if (++nodes > 192) fail('Formula is too complex');
    const height = 1 + Math.max(0, ...args.map(a => a?.height ?? 0));
    if (height > 32) fail('Use at most 32 levels of expression nesting');
    return { op, args, height };
  };
  function atom() {
    space();
    if (++depth > 32) fail('Use at most 32 levels of nesting');
    let result;
    if (take('(')) { result = expression(); if (!take(')')) fail('Expected )'); }
    else {
      const number = source.slice(position).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
      const name = source.slice(position).match(/^[a-zA-Z][a-zA-Z0-9_]*/);
      if (number) {
        position += number[0].length;
        const value = Number(number[0]);
        if (!Number.isFinite(value) || value > 1e30 || (value !== 0 && value < 1e-30) || (value === 0 && /[1-9]/.test(number[0].split(/[eE]/)[0]))) fail('Numbers must be zero or between 1e-30 and 1e30');
        result = node('number', value);
      } else if (name) {
        position += name[0].length;
        const id = name[0].toLowerCase();
        if (functions.has(id)) {
          if (!take('(')) fail(`Use ${id}(...)`);
          const a = expression();
          if (id === 'pow') { if (!take(',')) fail('pow needs two arguments'); result = node('^', a, expression()); }
          else result = node(id === 'log' ? 'ln' : id, a);
          if (!take(')')) fail('Expected )');
        } else if (['z', 'z1', 'z2', 'z3', 'z4', 'c', 'i', 'e', 'pi'].includes(id)) {
          let variable = id;
          if (id === 'z' && take('[')) {
            if (!take('n')) fail('Use z[n] or z[n-1] through z[n-4]');
            if (take('-')) {
              space(); const lag = source[position++];
              if (!['1', '2', '3', '4'].includes(lag)) fail('Orbit memory supports z1 through z4');
              variable = `z${lag}`;
            }
            if (!take(']')) fail('Expected ]');
          }
          result = node('variable', variable);
        } else fail(`Unknown name ${name[0]}`);
      } else fail('Expected a number, z, z1–z4, c, or a function');
    }
    depth--; return result;
  }
  function exponent() { const a = atom(); return take('**') || take('^') ? node('^', a, unary()) : a; }
  function unary() {
    if (take('+')) { if (++depth > 32) fail('Too many unary operators'); const a = unary(); depth--; return a; }
    if (take('-')) { if (++depth > 32) fail('Too many unary operators'); const a = node('neg', unary()); depth--; return a; }
    return exponent();
  }
  function product() {
    let a = unary();
    while (true) {
      // Exponents are consumed by exponent(), so a remaining * is multiplication.
      if (take('*')) a = node('*', a, unary());
      else if (take('/')) a = node('/', a, unary());
      else return a;
    }
  }
  function expression() {
    let a = product();
    while (true) {
      if (take('+')) a = node('+', a, product());
      else if (take('-')) a = node('-', a, product());
      else return a;
    }
  }
  const tree = expression(); space();
  if (position !== source.length) fail('Unexpected input; use * for multiplication');
  return tree;
}

const put = (out, r, i) => { out[0] = r; out[1] = i; return out; };
const ONE = [1, 0], HALF = [.5, 0];
const mul = ([a, b], [c, d], out) => put(out, a * c - b * d, a * d + b * c);
const ln = ([a, b], out) => put(out, Math.log(Math.hypot(a, b)), Math.atan2(b === 0 ? 0 : b, a));
const exp = ([a, b], out) => put(out, Math.exp(a) * Math.cos(b), Math.exp(a) * Math.sin(b));
function integerPower([a, b], n, out) {
  let r = 1, i = 0;
  for (let k = 0; k < Math.abs(n); k++) { const next = r * a - i * b; i = r * b + i * a; r = next; }
  put(out, r, i);
  return n < 0 ? divide(ONE, out, out) : out;
}
function divide([a, b], [c, d], out) {
  const scale = Math.max(Math.abs(c), Math.abs(d));
  const r = c / scale, i = d / scale, norm = r * r + i * i;
  return put(out, (a / scale * r + b / scale * i) / norm, (b / scale * r - a / scale * i) / norm);
}
function literal(node) { return node.op === 'number' ? node.args[0] : node.op === 'neg' && node.args[0].op === 'number' ? -node.args[0].args[0] : null; }
function power(a, b, out) {
  if (!b[0] && !b[1]) return put(out, 1, 0);
  if (!a[0] && !a[1] && b[0] > 0 && !b[1]) return put(out, 0, 0);
  return exp(mul(b, ln(a, out), out), out);
}
function compileCPU(tree) {
  if (tree.op === 'number') { const value = [tree.args[0], 0]; return () => value; }
  if (tree.op === 'variable') {
    const id = tree.args[0], constants = { i: [0, 1], e: [Math.E, 0], pi: [Math.PI, 0] };
    return Object.hasOwn(constants, id) ? () => constants[id] : env => env[id];
  }
  const a = compileCPU(tree.args[0]), b = tree.args[1] && compileCPU(tree.args[1]);
  // Each syntax node owns reusable storage. No temporary arrays are allocated
  // in the iteration loop, including for complex powers and functions.
  const out = [0, 0], numerator = [0, 0], denominator = [0, 0];
  const n = tree.op === '^' ? literal(tree.args[1]) : null;
  if (tree.op === '^' && Number.isInteger(n) && Math.abs(n) <= 16) return env => integerPower(a(env), n, out);
  if (tree.op === '^' && tree.args[0].op === 'variable' && tree.args[0].args[0] === 'e') return env => exp(b(env), out);
  return env => {
    const x = a(env), y = b?.(env), [r, i] = x;
    switch (tree.op) {
      case '+': return put(out, r + y[0], i + y[1]);
      case '-': return put(out, r - y[0], i - y[1]);
      case '*': return mul(x, y, out);
      case '/': return divide(x, y, out);
      case '^': return power(x, y, out);
      case 'neg': return put(out, -r, -i);
      case 'ln': return ln(x, out);
      case 'exp': return exp(x, out);
      case 'sqrt': return power(x, HALF, out);
      case 'sin': return put(out, Math.sin(r) * Math.cosh(i), Math.cos(r) * Math.sinh(i));
      case 'cos': return put(out, Math.cos(r) * Math.cosh(i), -Math.sin(r) * Math.sinh(i));
      case 'tan': return divide(put(numerator, Math.sin(r) * Math.cosh(i), Math.cos(r) * Math.sinh(i)), put(denominator, Math.cos(r) * Math.cosh(i), -Math.sin(r) * Math.sinh(i)), out);
      case 'sinh': return put(out, Math.sinh(r) * Math.cos(i), Math.cosh(r) * Math.sin(i));
      case 'cosh': return put(out, Math.cosh(r) * Math.cos(i), Math.sinh(r) * Math.sin(i));
      case 'abs': return put(out, Math.hypot(r, i), 0);
      case 'conj': return put(out, r, -i);
      case 're': return put(out, r, 0);
      case 'im': return put(out, i, 0);
    }
  };
}

const scalar = n => `${Number(n).toExponential(9)}`;
function realLiteral(n) {
  const hi = Math.fround(n), lo = Math.fround(n - hi);
  return `custom_real(${scalar(hi)},${scalar(lo)})`;
}
function compileWGSL(tree) {
  if (tree.op === 'number') return realLiteral(tree.args[0]);
  if (tree.op === 'variable') return ({ i: 'Native(rf(0),rf(1))', e: realLiteral(Math.E), pi: realLiteral(Math.PI) })[tree.args[0]] ?? tree.args[0];
  const a = compileWGSL(tree.args[0]), b = tree.args[1] && compileWGSL(tree.args[1]);
  if (tree.op === '^') {
    const n = literal(tree.args[1]);
    if (Number.isInteger(n) && Math.abs(n) <= 16) return `custom_ipow(${a},${n}i)`;
    if (tree.args[0].op === 'variable' && tree.args[0].args[0] === 'e') return `custom_exp(${b})`;
  }
  const names = { '+': 'na', '-': 'custom_sub', '*': 'nm', '/': 'custom_div', '^': 'custom_pow', neg: 'custom_neg' };
  return `${names[tree.op] ?? `custom_${tree.op}`}(${a}${b ? `,${b}` : ''})`;
}

export function compileFormula(source = DEFAULT_FORMULA) {
  if (cache.has(source)) return cache.get(source);
  const tree = parseFormula(source), step = compileCPU(tree);
  const result = { step, evaluate: env => step(env).slice(), wgsl: `fn custom_step(z:Native,z1:Native,z2:Native,z3:Native,z4:Native,c:Native)->Native {return ${compileWGSL(tree)};}` };
  cache.set(source, result);
  while (cache.size > 32) cache.delete(cache.keys().next().value);
  return result;
}

export function createCustomIterator(view, compiled = compileFormula(view.custom_formula)) {
  const julia = view.custom_mode === 'julia';
  const env = { z: [0, 0], z1: [0, 0], z2: [0, 0], z3: [0, 0], z4: [0, 0], c: [0, 0] };
  const keys = ['z', 'z1', 'z2', 'z3', 'z4'];
  const cr = Number(view.julia_x), ci = Number(view.julia_y);
  return (x, y) => {
    for (const key of keys) put(env[key], 0, 0);
    if (julia) { put(env.z, x, y); put(env.c, cr, ci); }
    else put(env.c, x, y);
    for (let n = 1; n <= view.iterations; n++) {
      const next = compiled.step(env), r = next[0], i = next[1], recycled = env.z4;
      env.z4 = env.z3; env.z3 = env.z2; env.z2 = env.z1; env.z1 = env.z; env.z = put(recycled, r, i);
      // General recurrences have no single smoothing exponent. Use escape
      // counts; non-finite results count as escape at the current step.
      if (!Number.isFinite(r) || !Number.isFinite(i) || Math.hypot(r, i) > view.bailout) return n;
    }
    return -1;
  };
}
export function iterateCustom(view, x, y, compiled) { return createCustomIterator(view, compiled)(x, y); }
