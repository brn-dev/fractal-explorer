// Normalized two-component arithmetic and floating point with a separate exponent.
// Explicit round-to-nearest operations protect the error-free transforms from
// compiler contraction. Products recover their residual using an explicit FMA.
template<class B> struct Basic;
template<> struct Basic<float> {
    __device__ static float add(float a,float b){return __fadd_rn(a,b);}
    __device__ static float sub(float a,float b){return __fsub_rn(a,b);}
    __device__ static float mul(float a,float b){return __fmul_rn(a,b);}
    __device__ static float fma(float a,float b,float c){return __fmaf_rn(a,b,c);}
    __device__ static float scale(float a,int e){return ldexpf(a,e);}
};
template<> struct Basic<double> {
    __device__ static double add(double a,double b){return __dadd_rn(a,b);}
    __device__ static double sub(double a,double b){return __dsub_rn(a,b);}
    __device__ static double mul(double a,double b){return __dmul_rn(a,b);}
    __device__ static double fma(double a,double b,double c){return __fma_rn(a,b,c);}
    __device__ static double scale(double a,int e){return ldexp(a,e);}
};
template<class B> struct Pair {
    B hi,lo;
    __device__ Pair():hi(0),lo(0){}
    __device__ Pair(double x):hi((B)x),lo((B)(x-(double)hi)){}
    __device__ Pair(B h,B l):hi(h),lo(l){}
    __device__ operator double()const{return (double)hi+(double)lo;}
};
template<class B> __device__ Pair<B> twosum(B a,B b){
    typedef Basic<B> O;
    B s=O::add(a,b),v=O::sub(s,a);
    return Pair<B>(s,O::add(O::sub(a,O::sub(s,v)),O::sub(b,v)));
}
template<class B> __device__ Pair<B> operator+(Pair<B>a,Pair<B>b){
    typedef Basic<B> O;
    Pair<B>s=twosum(a.hi,b.hi),t=twosum(a.lo,b.lo);
    Pair<B>u=twosum(s.hi,O::add(s.lo,t.hi));
    return twosum(u.hi,O::add(u.lo,t.lo));
}
template<class B> __device__ Pair<B> operator-(Pair<B>a){return Pair<B>(-a.hi,-a.lo);}
template<class B> __device__ Pair<B> operator-(Pair<B>a,Pair<B>b){return a+(-b);}
template<class B> __device__ Pair<B> operator*(Pair<B>a,Pair<B>b){
    typedef Basic<B> O;
    B p=O::mul(a.hi,b.hi),e=O::fma(a.hi,b.hi,-p);
    e=O::add(e,O::add(O::mul(a.hi,b.lo),O::mul(a.lo,b.hi)));
    e=O::add(e,O::mul(a.lo,b.lo));
    return twosum(p,e);
}
template<class R> __device__ R shift(R x,int e){return (R)ldexp((double)x,e);}
template<> __device__ float shift(float x,int e){return ldexpf(x,e);}
template<class B> __device__ Pair<B> shift(Pair<B>x,int e){
    return Pair<B>(Basic<B>::scale(x.hi,e),Basic<B>::scale(x.lo,e));
}
template<class R> __device__ R real(double h,double l){return R(h+l);}
template<> __device__ Pair<float> real(double h,double l){
    float a=(float)h;
    return twosum(a,(float)((h-(double)a)+l));
}
template<> __device__ Pair<double> real(double h,double l){return twosum(h,l);}
template<class R> struct Traits;
template<>struct Traits<float>{enum{bits=24,scale_limit=96};};
template<>struct Traits<double>{enum{bits=53,scale_limit=512};};
template<>struct Traits<Pair<float>>{enum{bits=48,scale_limit=96};};
template<>struct Traits<Pair<double>>{enum{bits=106,scale_limit=512};};
__device__ float head(float x){return x;}
__device__ double head(double x){return x;}
__device__ float head(Pair<float>x){return x.hi;}
__device__ double head(Pair<double>x){return x.hi;}
template<class R>__device__ R stored(float h,float l){return R(h);}
template<>__device__ Pair<float> stored(float h,float l){return Pair<float>(h,l);}
template<class R>__device__ R stored(double h,double l){return real<R>(h,l);}
template<>__device__ double stored(double h,double l){return h;}
template<>__device__ Pair<double> stored(double h,double l){return Pair<double>(h,l);}

template<class R> struct Exp {
    R m; int e;
    __device__ Exp():m(0),e(0){}
    __device__ Exp(double x):m(x),e(0){normalize();}
    __device__ Exp(R a,int b):m(a),e(b){normalize();}
    __device__ void normalize(){
        double v=(double)m;
        if(v==0){m=R(0);e=0;return;}
        int k;frexp(v,&k);m=shift(m,-k);e+=k;
        // A contracting orbit can square an exponent indefinitely. Values this
        // small cannot return to the supported 1e-10000 image scale within the
        // 50,000-step / bailout<=4096 budget. Zero them before int32 can wrap.
        if(e < -100000000){m=R(0);e=0;}
    }
    __device__ double value()const{return ldexp((double)m,e);}
    __device__ double logabs()const{return (double)m==0?log(0.0):log2(fabs((double)m))+e;}
};
template<class R>__device__ Exp<R> operator-(Exp<R>a){return Exp<R>(-a.m,a.e);}
template<class R>__device__ Exp<R> operator+(Exp<R>a,Exp<R>b){
    if((double)a.m==0)return b;if((double)b.m==0)return a;
    if(a.e<b.e){Exp<R>t=a;a=b;b=t;}
    if(a.e-b.e>Traits<R>::bits+8)return a;
    return Exp<R>(a.m+shift(b.m,b.e-a.e),a.e);
}
template<class R>__device__ Exp<R> operator-(Exp<R>a,Exp<R>b){return a+(-b);}
template<class R>__device__ Exp<R> operator*(Exp<R>a,Exp<R>b){return Exp<R>(a.m*b.m,a.e+b.e);}
template<class T>struct Complex {
    T r,i;
    __device__ Complex():r(0),i(0){}
    __device__ Complex(T a,T b):r(a),i(b){}
};
template<class T>__device__ Complex<T> operator+(Complex<T>a,Complex<T>b){return {a.r+b.r,a.i+b.i};}
template<class T>__device__ Complex<T> operator-(Complex<T>a,Complex<T>b){return {a.r-b.r,a.i-b.i};}
template<class T>__device__ Complex<T> operator*(Complex<T>a,Complex<T>b){
    return {a.r*b.r-a.i*b.i,a.r*b.i+a.i*b.r};
}
template<class T>__device__ Complex<T> twice(Complex<T>a){return {a.r+a.r,a.i+a.i};}
template<class R>__device__ double lognorm(Complex<Exp<R>>a){
    double x=a.r.logabs(),y=a.i.logabs(),h=fmax(x,y);
    if(!isfinite(h))return h;
    return h+0.5*log2(exp2(2*(x-h))+exp2(2*(y-h)));
}
__device__ double logadd(double a,double b){
    double h=fmax(a,b);return isfinite(h)?h+log2(exp2(a-h)+exp2(b-h)):h;
}
template<class R,class S>__device__ Complex<Exp<R>> loadwide(const S*m,const int*e,int id){
    return {Exp<R>(stored<R>(m[4*id],m[4*id+1]),e[2*id]),
            Exp<R>(stored<R>(m[4*id+2],m[4*id+3]),e[2*id+1])};
}
template<class R>__device__ Complex<R> native(Complex<Exp<R>>a){
    return {shift(a.r.m,a.r.e),shift(a.i.m,a.i.e)};
}
template<class R>__device__ Complex<Exp<R>> wide(Complex<R>a){return {Exp<R>(a.r,0),Exp<R>(a.i,0)};}
template<class R>__device__ Complex<Exp<R>> scaled_step(
    Complex<Exp<R>>z,Complex<Exp<R>>d,Complex<Exp<R>>c){
    int q=max(max(d.r.e,d.i.e),max(c.r.e,c.i.e));
    // Zero components have exponent 0; they must not set the common scale.
    q=-100000000;
    if((double)d.r.m!=0)q=max(q,d.r.e);if((double)d.i.m!=0)q=max(q,d.i.e);
    if((double)c.r.m!=0)q=max(q,c.r.e);if((double)c.i.m!=0)q=max(q,c.i.e);
    if(q==-100000000)return {};
    int low=q;
    if((double)d.r.m!=0)low=min(low,d.r.e);if((double)d.i.m!=0)low=min(low,d.i.e);
    if((double)c.r.m!=0)low=min(low,c.r.e);if((double)c.i.m!=0)low=min(low,c.i.e);
    Complex<R>zn=native(z);
    double size=hypot((double)zn.r,(double)zn.i);
    double tiny=Traits<R>::scale_limit==96?1e-20:1e-200;
    if(q-low>Traits<R>::scale_limit||size<tiny||
       ((double)zn.r==0&&(double)z.r.m!=0)||((double)zn.i==0&&(double)z.i.m!=0))
        return twice(z*d)+d*d+c;
    Complex<R>w={shift(d.r.m,d.r.e-q),shift(d.i.m,d.i.e-q)};
    Complex<R>v={shift(c.r.m,c.r.e-q),shift(c.i.m,c.i.e-q)};
    Complex<R>linear=twice(zn*w),sq=w*w;
    Complex<R>next=linear+Complex<R>(shift(sq.r,q),shift(sq.i,q))+v;
    double total=hypot((double)linear.r,(double)linear.i)+hypot((double)v.r,(double)v.i);
    if(hypot((double)next.r,(double)next.i)<total*1e-4)
        return twice(z*d)+d*d+c;
    return {Exp<R>(next.r,q),Exp<R>(next.i,q)};
}
