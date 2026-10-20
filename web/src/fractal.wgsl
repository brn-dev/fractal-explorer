struct Params {
  size:vec2u,limit:u32,kind:u32,
  bailout:f32,perturb:u32,series_n:u32,series_order:u32,
  span:Wide,center:vec4f,julia:vec4f,
  origin:vec2f,reserved:vec2u,tile:vec4u,
  options:vec4u,logs:vec4f,offsets:array<vec4u,4>
}
struct Reference {native:vec4f,z:Complex}
struct Bilinear {a:Complex,b:Complex,logs:vec4f}
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> reference:array<Reference>;
@group(0) @binding(2) var<storage,read> coefficients:array<Complex>;
@group(0) @binding(3) var<storage,read> maps:array<Bilinear>;
@group(0) @binding(4) var<storage,read_write> field:array<f32>;
@group(0) @binding(5) var<storage,read_write> stats:array<atomic<u32>>;

fn finish(id:u32,answer:f32,steps:u32,skipped:u32) {
  field[id]=answer;
  if(answer>=0){atomicMin(&stats[2],bitcast<u32>(answer));}
  if(answer < -1.5){atomicAdd(&stats[0],1u);atomicMin(&stats[1],id);}
  let old=atomicAdd(&stats[4],steps);if(old+steps<old){atomicAdd(&stats[5],1u);}
  let prior=atomicAdd(&stats[6],skipped);if(prior+skipped<prior){atomicAdd(&stats[7],1u);}
}
fn escape_value(n:u32,mag:f32,power:f32)->f32 {return max(0,f32(n)+1-log(log(sqrt(mag)))/log(power));}
fn load_native(j:u32)->Native {let a=reference[j].native;return Native(a.xy,a.zw);}
struct Jump {d:Complex,length:u32}
fn try_jump(d:Complex,dc:Complex,j:u32,n:u32)->Jump {
  let ld=clog(d);let lt=log_add(ld,p.logs.x);
  for(var level=i32(p.options.z)-1;level>=5;level--) {
    let length=1u<<u32(level);
    if((j&(length-1u))!=0 || n+length>p.limit || j+length>=arrayLength(&reference)){continue;}
    let l=u32(level);let node=p.offsets[l/4u][l%4u]+(j>>l);let map=maps[node];
    if(map.logs.x < -1e29 || ld>map.logs.x-1e-5){continue;}
    let size=log_add(map.logs.z+ld,map.logs.w+p.logs.x);
    let error=map.logs.y+2*lt;
    let rounding=select(-23.0,-43.0,PAIRED)+log2(f32(length)*32);
    if((error > -1e29 && error>size+p.logs.y-2) || rounding>p.logs.y-2){continue;}
    return Jump(ca(cm(map.a,d),cm(map.b,dc)),length);
  }
  return Jump(d,0u);
}
@compute @workgroup_size(8,8)
fn iterate(@builtin(global_invocation_id) gid:vec3u) {
  let pos=gid.xy+p.tile.xy;
  if(any(gid.xy>=p.tile.zw) || any(pos>=p.size)){return;}
  let id=pos.y*p.size.x+pos.x;
  if(p.options.x!=0u && field[id] > -1.5){return;}
  let ux=rd(rf(f32(pos.x)+.5-p.origin.x),rf(f32(p.size.x)));
  let uy=rd(rf(p.origin.y-f32(pos.y)-.5),rf(f32(p.size.x)));
  let u=Complex(wn(ux,0),wn(uy,0));let offset=Complex(wm(p.span,u.r),wm(p.span,u.i));
  var steps=0u;var skipped=0u;
  if(p.perturb==0u) {
    let s=wnative(p.span);
    let point=Native(ra(p.center.xy,rm(ux,s)),ra(p.center.zw,rm(uy,s)));
    let is_julia=p.kind==1u || p.kind==4u;
    var c=point;var z=nz();if(is_julia){c=Native(p.julia.xy,p.julia.zw);z=point;}
    if(p.kind==0u) {
      let x=c.r.x;let y=c.i.x;let q=(x-.25)*(x-.25)+y*y;
      // Margin avoids making membership decisions on a rounded boundary.
      if(q*(q+x-.25)<.25*y*y-1e-6 || (x+1)*(x+1)+y*y<.0625-1e-6){finish(id,-1,0,0);return;}
    }
    for(var n=1u;n<=p.limit;n++) {
      if(p.kind==4u){z=na(nm(nm(z,z),z),c);}
      else {
        if(p.kind==3u){z.i=-z.i;}
        z=na(nm(z,z),c);
        if(p.kind==2u){if(z.r.x<0){z.r=-z.r;}if(z.i.x<0){z.i=-z.i;}}
      }
      steps++;let mag=nmag(z);
      if(mag>p.bailout*p.bailout){finish(id,escape_value(n,mag,select(2.0,3.0,p.kind==4u)),steps,0);return;}
    }
    finish(id,-1,steps,0);return;
  }
  var dc=offset;var d=cz();if(p.kind==1u){dc=cz();d=offset;}
  var n=0u;var j=0u;
  if(p.series_n>0u){
    var v=coefficients[p.series_order];
    for(var k=i32(p.series_order)-1;k>=1;k--){v=ca(cm(v,u),coefficients[u32(k)]);}
    d=cm(v,u);n=p.series_n;j=n;skipped=n;
  }
  if(!EXTENDED) {
    var dn=cnative(d);let cn=cnative(dc);
    while(n<p.limit) {
      if(j+1u>=arrayLength(&reference)){finish(id,-2,steps,skipped);return;}
      if(p.options.z>5u && (j&31u)==0u){
        let jump=try_jump(cwide(dn),dc,j,n);
        if(jump.length>0u){
          dn=cnative(jump.d);n+=jump.length;j+=jump.length;skipped+=jump.length;
          let rn=load_native(j);let actual=na(rn,dn);let mag=nmag(actual);
          if(mag>p.bailout*p.bailout || mag<select(1e-4,1e-8,PAIRED)*nmag(rn)){finish(id,-2,steps,skipped);return;}
          continue;
        }
      }
      let zr=load_native(j);dn=na(na(ntwice(nm(zr,dn)),nm(dn,dn)),cn);n++;j++;steps++;
      let rn=load_native(j);let actual=na(rn,dn);let mag=nmag(actual);
      if(mag>p.bailout*p.bailout){finish(id,escape_value(n,mag,2),steps,skipped);return;}
      if(mag<select(1e-4,1e-8,PAIRED)*nmag(rn)){finish(id,-2,steps,skipped);return;}
      if(p.kind==0u && (mag<nmag(dn) || j+1u==arrayLength(&reference))){dn=actual;j=0u;}
    }
  } else {
    while(n<p.limit) {
      if(j+1u>=arrayLength(&reference)){finish(id,-2,steps,skipped);return;}
      if(p.options.z>5u && (j&31u)==0u){
        let jump=try_jump(d,dc,j,n);
        if(jump.length>0u){
          d=jump.d;n+=jump.length;j+=jump.length;skipped+=jump.length;
          let rn=reference[j].z;let actual=ca(rn,d);let mag=nmag(cnative(actual));
          if(mag>p.bailout*p.bailout || clog(actual)<clog(rn)-select(6.64,13.28,PAIRED)){finish(id,-2,steps,skipped);return;}
          continue;
        }
      }
      d=extended_step(reference[j].z,d,dc);n++;j++;steps++;
      let rn=reference[j].z;let actual=ca(rn,d);let mag=nmag(cnative(actual));
      if(mag>p.bailout*p.bailout){finish(id,escape_value(n,mag,2),steps,skipped);return;}
      if(clog(actual)<clog(rn)-select(6.64,13.28,PAIRED)){finish(id,-2,steps,skipped);return;}
      if(p.kind==0u && (clog(actual)<clog(d) || j+1u==arrayLength(&reference))){d=actual;j=0u;}
    }
  }
  finish(id,-1,steps,skipped);
}

