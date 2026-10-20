// ARITH and RANGE are selected at compile time. All full-range state keeps
// separate exponents, including both components of every reference sample.
#if ARITH == 0
using R=float;
#elif ARITH == 1
using R=Pair<float>;
#elif ARITH == 2
using R=double;
#else
using R=Pair<double>;
#endif
#if ARITH < 2
using Storage=float;
using Tally=float;
#else
using Storage=double;
using Tally=double;
#endif
using W=Exp<R>;
using CW=Complex<W>;
using CN=Complex<R>;
__device__ float finish_value(int n,double mag,int power){
    return (float)fmax(0.0,n+1.0-log(log(sqrt(mag)))/log((double)power));
}
__device__ CN loadnative(const Storage*p,int j){return {stored<R>(p[4*j],p[4*j+1]),stored<R>(p[4*j+2],p[4*j+3])};}
__device__ CN abs_components(CN z){return {((double)z.r<0)?-z.r:z.r,((double)z.i<0)?-z.i:z.i};}
__device__ int try_jump(CW&d,CW dc,int j,int n,int limit,int ref_len,
    const Storage*map_m,const int*map_e,const double*map_logs,const int*offsets,
    int levels,double log_dc_bound,double log_tolerance){
    double ld=lognorm(d),lt=logadd(ld,log_dc_bound);
    int max_level=j==0?levels-1:min(levels-1,__ffs(j)-1);
    for(int k=max_level;k>=5;--k){
        int length=1<<k;
        if(n+length>limit||j+length>=ref_len)continue;
        int node=offsets[k]+(j>>k);
        const double*l=map_logs+5*node;
        // Radius zero disables a node, including when d is exactly zero.
        // Comparing -infinity with -infinity alone would accept that case.
        if(!isfinite(l[0])||ld>l[0]-1e-12)continue;
        double scale=logadd(l[2]+ld,l[3]+log_dc_bound);
        double error=l[1]+2*lt;
        double rounding=(1-Traits<R>::bits)+log2((double)length*32.0);
        if((isfinite(error)&&error>scale+log_tolerance-2)||rounding>log_tolerance-2)continue;
        CW a=loadwide<R>(map_m+8*node,map_e+4*node,0);
        CW b=loadwide<R>(map_m+8*node,map_e+4*node,1);
        d=a*d+b*dc;return length;
    }
    return 0;
}
#define FINISH(v) {out[id]=(float)(v);counts[id]=steps;counts[total+id]=skipped;return;}

extern "C" __global__ void render_optimized(
    float*out,int*counts,const float*repair_mask,int repair_only,int width,int height,int kind,int limit,double bailout,
    const double*center,double span_hi,double span_lo,int span_e,int perturb,
    const Storage*ref_native,const Storage*ref_m,const int*ref_e,int ref_len,
    const Storage*series_m,const int*series_e,int series_order,int series_n,
    const Storage*map_m,const int*map_e,const double*map_logs,const int*offsets,
    int levels,double log_dc_bound,double log_tolerance
){
    int id=blockIdx.x*blockDim.x+threadIdx.x,total=width*height;
    if(id>=total)return;
    if(repair_only&&repair_mask[id]!=-2){out[id]=repair_mask[id];counts[id]=0;counts[total+id]=0;return;}
    int row=id/width,col=id%width,steps=0,skipped=0;
    R ux=R((col+0.5)/width-0.5),uy=R((height/2.0-row-0.5)/width);
    W span(real<R>(span_hi,span_lo),span_e);
    if(!perturb){
        R s=shift(span.m,span.e);
        CN point={real<R>(center[0],center[1])+ux*s,real<R>(center[2],center[3])+uy*s};
        CN c=(kind==1||kind==4)?CN(real<R>(center[4],center[5]),real<R>(center[6],center[7])):point;
        CN z=(kind==1||kind==4)?point:CN();
        if(kind==0&&span.value()>1e-8){
            double x=(double)c.r,y=(double)c.i,q=(x-.25)*(x-.25)+y*y;
            if(q*(q+x-.25)<=.25*y*y||(x+1)*(x+1)+y*y<=.0625)FINISH(-1);
        }
        for(int n=0;n<limit;++n){
            if(kind==4){CN z2=z*z;z=z2*z+c;}
            else if(kind==2)z=abs_components(z*z+c);
            else {if(kind==3)z.i=-z.i;z=z*z+c;}
            ++steps;double mag=(double)z.r*(double)z.r+(double)z.i*(double)z.i;
            if(mag>bailout*bailout)FINISH(finish_value(n+1,mag,kind==4?3:2));
        }
        FINISH(-1);
    }
    CW u={W(ux,0),W(uy,0)},offset={span*u.r,span*u.i};
    CW dc=kind==1?CW():offset,d=kind==1?offset:CW();
    int n=0,j=0;
    if(series_n>0){
        CW value=loadwide<R>(series_m,series_e,series_order);
        for(int k=series_order-1;k>=1;--k)value=value*u+loadwide<R>(series_m,series_e,k);
        d=value*u;n=j=series_n;skipped=series_n;
    }
#if RANGE == 0
    // Keep native state native. Exponent arithmetic is needed only for a BLA
    // jump, never for the ordinary FP32/FP64/pair escape loop.
    CN dn=native(d),cn=native(dc);
    while(n<limit){
        if(j+1>=ref_len)FINISH(-2);
        if(levels>5&&(j&31)==0){
            CW candidate=wide(dn);
            int length=try_jump(candidate,dc,j,n,limit,ref_len,map_m,map_e,map_logs,offsets,
                                levels,log_dc_bound,log_tolerance);
            if(length){
                dn=native(candidate);n+=length;j+=length;skipped+=length;
                CN rn=loadnative(ref_native,j),actual=rn+dn;
                Tally x=head(actual.r),y=head(actual.i),rx=head(rn.r),ry=head(rn.i);
                Tally mag=x*x+y*y,glitch=ARITH==0?Tally(1e-4):(ARITH==3?Tally(1e-16):Tally(1e-8));
                if(mag>bailout*bailout||mag<glitch*(rx*rx+ry*ry))FINISH(-2);
                continue;
            }
        }
        CN zn=loadnative(ref_native,j);
        dn=twice(zn*dn)+dn*dn+cn;++n;++j;++steps;
        CN rn=loadnative(ref_native,j),actual=rn+dn;
        Tally x=head(actual.r),y=head(actual.i),mag=x*x+y*y;
        if(mag>bailout*bailout)FINISH(finish_value(n,mag,2));
        Tally rx=head(rn.r),ry=head(rn.i),dx=head(dn.r),dy=head(dn.i);
        Tally glitch=ARITH==0?Tally(1e-4):(ARITH==3?Tally(1e-16):Tally(1e-8));
        if(mag<glitch*(rx*rx+ry*ry))FINISH(-2);
        if(kind==0&&(mag<dx*dx+dy*dy||j+1==ref_len)){dn=actual;j=0;}
    }
    FINISH(-1);
#else
    while(n<limit){
        if(j+1>=ref_len)FINISH(-2);
        if(levels>5&&(j&31)==0){
            int length=try_jump(d,dc,j,n,limit,ref_len,map_m,map_e,map_logs,offsets,
                                levels,log_dc_bound,log_tolerance);
            if(length){
                n+=length;j+=length;skipped+=length;
                CW rn=loadwide<R>(ref_m,ref_e,j),actual=rn+d;
                double x=actual.r.value(),y=actual.i.value();
                double guard=ARITH==0?6.64385619:(ARITH==3?26.57542476:13.28771238);
                if(x*x+y*y>bailout*bailout||lognorm(actual)<lognorm(rn)-guard)FINISH(-2);
                continue;
            }
        }
        CW zref=loadwide<R>(ref_m,ref_e,j);
#if RANGE == 0
        CN zn=loadnative(ref_native,j),dn=native(d),cn=native(dc);
        d=wide(twice(zn*dn)+dn*dn+cn);
#elif RANGE == 1
        d=scaled_step(zref,d,dc);
#else
        d=twice(zref*d)+d*d+dc;
#endif
        ++n;++j;++steps;
        CW refnext=loadwide<R>(ref_m,ref_e,j),actual=refnext+d;
        double x=actual.r.value(),y=actual.i.value(),mag=x*x+y*y;
        if(mag>bailout*bailout)FINISH(finish_value(n,mag,2));
        double la=lognorm(actual),lr=lognorm(refnext);
        double glitch_bits=ARITH==0?6.64385619:(ARITH==3?26.57542476:13.28771238);
        if(la<lr-glitch_bits)FINISH(-2);
        if(kind==0&&(la<lognorm(d)||j+1==ref_len)){d=actual;j=0;}
    }
    FINISH(-1);
#endif
}

// Independent primitive check used by the numerical test suite.
extern "C" __global__ void arithmetic_probe(const double*input,double*output,int count){
    int k=blockIdx.x*blockDim.x+threadIdx.x;if(k>=count)return;
    R a=real<R>(input[4*k],input[4*k+1]),b=real<R>(input[4*k+2],input[4*k+3]);
    R sum=a+b,product=a*b;
    // Keep residual components visible instead of rounding the result to FP64.
#if ARITH == 1 || ARITH == 3
    output[4*k]=sum.hi;output[4*k+1]=sum.lo;output[4*k+2]=product.hi;output[4*k+3]=product.lo;
#else
    output[4*k]=(double)sum;output[4*k+1]=0;output[4*k+2]=(double)product;output[4*k+3]=0;
#endif
}
