// Algebra uses paired arithmetic. Transcendental functions use native f32.
fn custom_real(hi:f32,lo:f32)->Native {return Native(vec2f(hi,select(0.0,lo,PAIRED)),rf(0));}
fn custom_value(z:Native)->vec2f {return vec2f(z.r.x+z.r.y,z.i.x+z.i.y);}
fn custom_native(z:vec2f)->Native {return Native(rf(z.x),rf(z.y));}
fn custom_bad()->Native {return custom_native(vec2f(1e30));}
fn custom_neg(z:Native)->Native {return Native(-z.r,-z.i);}
fn custom_sub(a:Native,b:Native)->Native {return na(a,custom_neg(b));}
fn custom_div(a:Native,b:Native)->Native {
  if(all(custom_value(b)==vec2f(0))){return custom_bad();}
  return ndivide(a,b);
}
fn custom_ipow(z:Native,n:i32)->Native {
  var v=Native(rf(1),rf(0));
  for(var k=0i;k<abs(n);k++){v=nm(v,z);}
  if(n<0){return custom_div(Native(rf(1),rf(0)),v);}return v;
}
fn custom_ln(z:Native)->Native {
  let v=custom_value(z);let scale=max(abs(v.x),abs(v.y));
  if(scale==0){return custom_bad();}
  let u=v/scale;var angle=atan2(v.y,v.x);if(v.y==0 && v.x<0){angle=3.141592653589793;}
  return custom_native(vec2f(log(scale)+.5*log(dot(u,u)),angle));
}
fn custom_exp(z:Native)->Native {
  let v=custom_value(z);if(v.x>80){return custom_bad();}
  return custom_native(exp(v.x)*vec2f(cos(v.y),sin(v.y)));
}
fn custom_pow(a:Native,b:Native)->Native {
  let exponent=custom_value(b);
  if(all(exponent==vec2f(0))){return Native(rf(1),rf(0));}
  if(all(custom_value(a)==vec2f(0))){if(exponent.x>0 && exponent.y==0){return nz();}return custom_bad();}
  return custom_exp(nm(b,custom_ln(a)));
}
fn custom_sqrt(z:Native)->Native {return custom_pow(z,Native(rf(.5),rf(0)));}
fn custom_sin(z:Native)->Native {let v=custom_value(z);return custom_native(vec2f(sin(v.x)*cosh(v.y),cos(v.x)*sinh(v.y)));}
fn custom_cos(z:Native)->Native {let v=custom_value(z);return custom_native(vec2f(cos(v.x)*cosh(v.y),-sin(v.x)*sinh(v.y)));}
fn custom_tan(z:Native)->Native {return custom_div(custom_sin(z),custom_cos(z));}
fn custom_sinh(z:Native)->Native {let v=custom_value(z);return custom_native(vec2f(sinh(v.x)*cos(v.y),cosh(v.x)*sin(v.y)));}
fn custom_cosh(z:Native)->Native {let v=custom_value(z);return custom_native(vec2f(cosh(v.x)*cos(v.y),sinh(v.x)*sin(v.y)));}
fn custom_abs(z:Native)->Native {let v=custom_value(z);let s=max(abs(v.x),abs(v.y));if(s==0){return nz();}return custom_native(vec2f(s*length(v/s),0));}
fn custom_conj(z:Native)->Native {return Native(z.r,-z.i);}
fn custom_re(z:Native)->Native {return Native(z.r,rf(0));}
fn custom_im(z:Native)->Native {return Native(z.i,rf(0));}
