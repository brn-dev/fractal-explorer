// Paired FP32 arithmetic deliberately avoids assuming IEEE fused fma().
// Device probes validate these transforms before enabling paired shaders.
override PAIRED: bool = true;
override EXTENDED: bool = false;
fn two_sum(a:f32,b:f32)->vec2f {
  let s=round32(a+b); let v=round32(s-a);
  return vec2f(s,round32(round32(a-round32(s-v))+round32(b-v)));
}
fn ra(a:vec2f,b:vec2f)->vec2f {
  if (!PAIRED) {return vec2f(a.x+b.x,0);}
  let s=two_sum(a.x,b.x);let t=two_sum(a.y,b.y);
  let u=two_sum(s.x,round32(s.y+t.x));return two_sum(u.x,round32(u.y+t.y));
}
fn rn(a:vec2f)->vec2f {return -a;}
fn rs(a:vec2f,b:vec2f)->vec2f {return ra(a,-b);}
fn rm(a:vec2f,b:vec2f)->vec2f {
  if (!PAIRED) {return vec2f(a.x*b.x,0);}
  let ah=bitcast<f32>(bitcast<u32>(a.x)&0xfffff000u);let al=round32(a.x-ah);
  let bh=bitcast<f32>(bitcast<u32>(b.x)&0xfffff000u);let bl=round32(b.x-bh);
  let p=round32(a.x*b.x);
  var e=round32(round32(round32(round32(ah*bh)-p)+round32(ah*bl))+round32(al*bh));
  e=round32(e+round32(al*bl));
  e=round32(e+round32(round32(a.x*b.y)+round32(a.y*b.x))); e=round32(e+round32(a.y*b.y));
  return two_sum(p,e);
}
fn rf(x:f32)->vec2f {return vec2f(x,0);}
fn rd(a:vec2f,b:vec2f)->vec2f {
  let q=rf(round32(a.x/b.x));
  if(!PAIRED){return q;}
  let remainder=rs(a,rm(b,q));
  return ra(q,rf(round32(round32(remainder.x+remainder.y)/b.x)));
}
fn rshift(a:vec2f,e:i32)->vec2f {if(all(a==vec2f(0))){return a;}return ldexp(a,vec2i(e));}
struct Wide {m:vec2f,e:i32,pad:i32}
struct Complex {r:Wide,i:Wide}
struct Native {r:vec2f,i:vec2f}
fn wz()->Wide {return Wide(vec2f(0),0,0);}
fn wn(m:vec2f,e:i32)->Wide {
  if(m.x==0 || e < -100000000) {return wz();}
  let f=frexp(m.x);return Wide(rshift(m,-f.exp),e+f.exp,0);
}
fn wf(x:f32)->Wide {return wn(rf(x),0);}
fn wa(x:Wide,y:Wide)->Wide {
  var a=x;var b=y;
  if(a.m.x==0){return b;}if(b.m.x==0){return a;}
  if(a.e<b.e){a=y;b=x;}
  if(a.e-b.e>60){return a;}
  return wn(ra(a.m,rshift(b.m,b.e-a.e)),a.e);
}
fn wm(a:Wide,b:Wide)->Wide {return wn(rm(a.m,b.m),a.e+b.e);}
fn wneg(a:Wide)->Wide {return Wide(-a.m,a.e,0);}
fn ws(a:Wide,b:Wide)->Wide {return wa(a,wneg(b));}
fn wnative(a:Wide)->vec2f {if(a.e < -110){return vec2f(0);}return rshift(a.m,a.e);}
fn wlog(a:Wide)->f32 {if(a.m.x==0){return -1e30;}return log2(abs(a.m.x))+f32(a.e);}
fn cz()->Complex {return Complex(wz(),wz());}
fn ca(a:Complex,b:Complex)->Complex {return Complex(wa(a.r,b.r),wa(a.i,b.i));}
fn cm(a:Complex,b:Complex)->Complex {return Complex(ws(wm(a.r,b.r),wm(a.i,b.i)),wa(wm(a.r,b.i),wm(a.i,b.r)));}
fn ctwice(a:Complex)->Complex {return ca(a,a);}
fn cwide(a:Native)->Complex {return Complex(wn(a.r,0),wn(a.i,0));}
fn cnative(a:Complex)->Native {return Native(wnative(a.r),wnative(a.i));}
fn na(a:Native,b:Native)->Native {return Native(ra(a.r,b.r),ra(a.i,b.i));}
fn nm(a:Native,b:Native)->Native {return Native(rs(rm(a.r,b.r),rm(a.i,b.i)),ra(rm(a.r,b.i),rm(a.i,b.r)));}
fn ntwice(a:Native)->Native {return na(a,a);}
fn nz()->Native {return Native(vec2f(0),vec2f(0));}
fn nmag(a:Native)->f32 {return dot(vec2f(a.r.x,a.i.x),vec2f(a.r.x,a.i.x));}
fn clog(a:Complex)->f32 {
  let x=wlog(a.r);let y=wlog(a.i);let h=max(x,y);
  if(h < -1e29){return -1e30;}
  return h+.5*log2(exp2(2*(x-h))+exp2(2*(y-h)));
}
fn log_add(a:f32,b:f32)->f32 {let h=max(a,b);if(h < -1e29){return -1e30;}return h+log2(exp2(a-h)+exp2(b-h));}
fn extended_step(z:Complex,d:Complex,c:Complex)->Complex {
  // Use an ordinary mantissa loop when one shared scale is safe; preserve both
  // component exponents across critical points and cancellation otherwise.
  var q=-100000000;var low=100000000;
  if(d.r.m.x!=0){q=max(q,d.r.e);low=min(low,d.r.e);}
  if(d.i.m.x!=0){q=max(q,d.i.e);low=min(low,d.i.e);}
  if(c.r.m.x!=0){q=max(q,c.r.e);low=min(low,c.r.e);}
  if(c.i.m.x!=0){q=max(q,c.i.e);low=min(low,c.i.e);}
  if(q == -100000000){return cz();}
  let zn=cnative(z);
  if(q-low>70 || nmag(zn)<1e-20 || (q < -90 && (abs(z.r.m.x)+abs(z.i.m.x))==0)) {
    return ca(ca(ctwice(cm(z,d)),cm(d,d)),c);
  }
  let dn=Native(rshift(d.r.m,d.r.e-q),rshift(d.i.m,d.i.e-q));
  let cn=Native(rshift(c.r.m,c.r.e-q),rshift(c.i.m,c.i.e-q));
  let linear=ntwice(nm(zn,dn));let square=nm(dn,dn);
  var sq=nz();
  if(q>=-100 && q<=100){sq=Native(rshift(square.r,q),rshift(square.i,q));}
  // A nonzero squared term outside the safe native range must retain its exponent.
  if(q>100 || (q < -100 && nmag(zn)==0)){return ca(ca(ctwice(cm(z,d)),cm(d,d)),c);}
  let result=na(na(linear,sq),cn);
  if(nmag(result)<1e-8*(nmag(linear)+nmag(cn))){return ca(ca(ctwice(cm(z,d)),cm(d,d)),c);}
  return Complex(wn(result.r,q),wn(result.i,q));
}
