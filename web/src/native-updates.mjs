// The native host downloads/verifies complete releases. A running page stays
// pinned to its release until the user chooses to reload.
export function createNativeUpdateMonitor({ call, identity, saveSession, canReload = () => true, onChange,
  visibility = document, events = window, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let state = { checking:false, available:false, applying:false, notice:false, error:'' };
  let stopped = false, dismissed = '', timer = null, applyTimer = null;
  const emit = next => {
    if(stopped)return;
    state = { ...state, ...next };
    state.notice = state.available && state.readyVersion !== dismissed;
    onChange({ ...state });
  };
  const poll = () => {
    clearTimer(timer);timer=null;if(stopped)return;
    try { emit(call('status')); } catch(error) { emit({checking:false,error:error.message}); }
    if(state.checking&&!visibility.hidden)timer=setTimer(poll,1000);
  };
  const check = ({force=true,announce=true} = {}) => {
    if(stopped)return false;
    if(announce)dismissed='';
    try { emit(call(force?'check':'auto'));poll();return true; }
    catch(error){emit({checking:false,error:error.message});return false;}
  };
  const wake = () => { if(!visibility.hidden)check({force:false,announce:false}); };
  for(const name of ['online','focus'])events.addEventListener(name,wake);
  visibility.addEventListener('visibilitychange',wake);
  const started = (async()=>{
    try {
      const info=await identity();if(stopped)return;
      emit(call('confirm',info.id));check({force:false,announce:false});
    }catch(error){emit({error:error.message});}
  })();
  return {
    started, check,
    dismiss(){dismissed=state.readyVersion;emit({});},
    async apply(){
      if(stopped||state.applying||!state.available)return false;
      const allowed=canReload();if(allowed!==true){emit({error:allowed||'Finish the current task before updating.'});return false;}
      emit({applying:true,error:''});
      try {
        await saveSession();if(stopped)return false;
        call('apply');
        applyTimer=setTimer(()=>{emit({applying:false,error:'The update did not reload. You can retry, or use Explorer updates in the app menu.'});},15000);
        return true;
      }catch(error){emit({applying:false,error:error.message});return false;}
    },
    destroy(){stopped=true;clearTimer(timer);clearTimer(applyTimer);for(const name of ['online','focus'])events.removeEventListener(name,wake);visibility.removeEventListener('visibilitychange',wake);},
  };
}
