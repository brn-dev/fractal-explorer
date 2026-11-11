export const MAX_CURVE_POINTS = 65;
export const CURVE_GAP = .001;
const clamp = value => Math.max(0, Math.min(1, value));

export function validateCurve(data, mode = 'free') {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      !Array.isArray(data.points) || data.points.length < 2 || data.points.length > MAX_CURVE_POINTS)
    throw new Error(`Choose a curve with 2–${MAX_CURVE_POINTS} points.`);
  const points = data.points.map(point => {
    if (!Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value) || value < 0 || value > 1))
      throw new Error('Curve points must stay between 0% and 100%.');
    return [...point];
  });
  if (points[0][0] !== 0 || points.at(-1)[0] !== 1 || points.some((p,i) => i && p[0] - points[i-1][0] < CURVE_GAP - 1e-10))
    throw new Error('Curve input positions must span 0–100% and stay at least 0.1% apart.');
  if (mode !== 'free' && (points[0][1] !== 0 || points.at(-1)[1] !== (mode === 'cycle' ? 0 : 1)))
    throw new Error(mode === 'cycle' ? 'A loop must start and return to Start (0%).' : 'A transition must start at 0% and finish at 100%.');
  const interpolation = data.interpolation ?? 'smooth';
  if (!['smooth','segments'].includes(interpolation)) throw new Error('Choose smooth or segment interpolation.');
  const bends = data.bends ?? Array(points.length-1).fill(0);
  if (!Array.isArray(bends) || bends.length !== points.length-1 || bends.some(value => !Number.isFinite(value) || value < -1 || value > 1))
    throw new Error('Curve bends must stay between −100% and 100%.');
  return { points, interpolation, bends: [...bends] };
}

export function compileCurve(data, mode = 'free') {
  const {points,interpolation,bends}=validateCurve(data,mode), n=points.length;
  const h=points.slice(1).map((point,i)=>point[0]-points[i][0]);
  const d=h.map((width,i)=>(points[i+1][1]-points[i][1])/width), m=[d[0]];
  for(let i=1;i<n-1;i++) {
    if(d[i-1]*d[i]<=0)m[i]=0;
    else {const a=2*h[i]+h[i-1],b=h[i]+2*h[i-1];m[i]=(a+b)/(a/d[i-1]+b/d[i]);}
  }
  m[n-1]=d.at(-1);
  return x => {
    if(x<=0)return points[0][1];if(x>=1)return points.at(-1)[1];
    let low=0,high=n-1;while(high-low>1){const mid=(low+high)>>1;if(points[mid][0]>x)high=mid;else low=mid;}
    const t=(x-points[low][0])/h[low],a=points[low][1],b=points[low+1][1];
    if(interpolation==='segments') {
      const bend=bends[low],u=bend>=0?t**(1+4*bend):1-(1-t)**(1-4*bend);
      return clamp(a+(b-a)*u);
    }
    const t2=t*t,t3=t2*t;
    return clamp((2*t3-3*t2+1)*a+(t3-2*t2+t)*h[low]*m[low]+(-2*t3+3*t2)*b+(t3-t2)*h[low]*m[low+1]);
  };
}

export function curveFromFunction(fn, mode = 'free', tolerance = .002) {
  const samples=Array.from({length:257},(_,i)=>[i/256,clamp(fn(i/256))]);
  if(mode!=='free'){samples[0][1]=0;samples[256][1]=mode==='cycle'?0:1;}
  const selected=[0,256];
  while(selected.length<MAX_CURVE_POINTS) {
    let worst=tolerance,at=-1;
    for(let s=0;s<selected.length-1;s++) {
      const a=selected[s],b=selected[s+1];
      for(let i=a+1;i<b;i++){const value=samples[a][1]+(samples[b][1]-samples[a][1])*(i-a)/(b-a),error=Math.abs(samples[i][1]-value);if(error>worst){worst=error;at=i;}}
    }
    if(at<0)break;selected.push(at);selected.sort((a,b)=>a-b);
  }
  return validateCurve({points:selected.map(i=>samples[i]),interpolation:'segments'},mode);
}

export function defaultCurve(mode = 'free') {
  return validateCurve({points:mode==='cycle'?[[0,0],[.5,1],[1,0]]:[[0,0],[.5,.5],[1,1]],interpolation:mode==='cycle'?'segments':'smooth'},mode);
}
