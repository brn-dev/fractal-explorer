struct Colors {size:vec2u,density:f32,phase:f32,origin:f32,pad:vec3f}
@group(0) @binding(0) var<uniform> settings:Colors;
@group(0) @binding(1) var<storage,read> field:array<f32>;
@group(0) @binding(2) var<storage,read> palette:array<vec4f>;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  let x=f32((i<<1u)&2u);let y=f32(i&2u);
  return vec4f(x*2-1,y*2-1,0,1);
}
@fragment fn fragment(@builtin(position) p:vec4f)->@location(0) vec4f {
  let pos=min(vec2u(p.xy),settings.size-vec2u(1));let n=field[pos.y*settings.size.x+pos.x];
  if(n < -1.5){return vec4f(.5,.28,.12,1);}
  if(n < 0){return vec4f(.03137,.06667,.07059,1);}
  let t=fract(log(1+max(0,n-settings.origin))*.2*settings.density+settings.phase);
  return palette[min(4095u,u32(t*4096))];
}
