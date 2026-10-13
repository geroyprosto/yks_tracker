'use client';
import {useEffect,useRef,useState} from 'react';

const VERSION_INTERVAL=30_000;
const FALLBACK_INTERVAL=120_000;
const REPAIR_INTERVAL=300_000;

/** Short, visible-tab reads replace the persistent server connection. */
export function useStudyRealtime({enabled,onDirty,onReconnect}:{enabled:boolean;onDirty:()=>void;onReconnect?:()=>void}){
  const [status,setStatus]=useState<'disabled'|'connected'|'error'>('disabled');
  const callbacks=useRef({onDirty,onReconnect});
  useEffect(()=>{callbacks.current={onDirty,onReconnect};},[onDirty,onReconnect]);
  useEffect(()=>{
    if(!enabled)return;
    let stopped=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let active:AbortController|null=null;
    let version:string|null|undefined;
    let lastRepair=Date.now();
    let initialized=false;
    const visible=()=>!stopped&&navigator.onLine&&document.visibilityState==='visible';
    const repair=()=>{lastRepair=Date.now();(callbacks.current.onReconnect??callbacks.current.onDirty)();};
    const check=async(resuming=false)=>{
      if(!visible()||active)return;
      clearTimeout(timer);
      const controller=new AbortController();active=controller;
      const timeout=setTimeout(()=>controller.abort(),10_000);
      let interval=VERSION_INTERVAL;
      try{
        const response=await fetch('/api/realtime?session=1',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
        const body=await response.json();
        if(!visible()||active!==controller)return;
        if(!response.ok)throw new Error('Version check unavailable');
        if(body.enabled===true&&(body.version===null||typeof body.version==='string')){
          setStatus('connected');
          if(!initialized||version===undefined){
            // Close the race between the initial state read and version baseline.
            repair();
          }else if(version!==body.version){
            lastRepair=Date.now();callbacks.current.onDirty();
          }else if(resuming||Date.now()-lastRepair>=REPAIR_INTERVAL)repair();
          version=body.version;
        }else if(body.enabled===false){
          setStatus('disabled');interval=FALLBACK_INTERVAL;version=undefined;
          if(resuming||Date.now()-lastRepair>=FALLBACK_INTERVAL)repair();
        }else throw new Error('Invalid version response');
        initialized=true;
      }catch{
        if(!visible()||active!==controller)return;
        setStatus('error');interval=FALLBACK_INTERVAL;version=undefined;
        if(resuming||Date.now()-lastRepair>=FALLBACK_INTERVAL)repair();
      }finally{
        clearTimeout(timeout);
        if(active===controller){active=null;if(visible())timer=setTimeout(()=>void check(),interval);}
      }
    };
    const suspend=()=>{clearTimeout(timer);const controller=active;active=null;controller?.abort();};
    const resume=()=>{if(visible())void check(true);else suspend();};
    void check();
    document.addEventListener('visibilitychange',resume);
    window.addEventListener('online',resume);
    window.addEventListener('offline',suspend);
    window.addEventListener('pagehide',suspend);
    window.addEventListener('pageshow',resume);
    return()=>{
      stopped=true;suspend();
      document.removeEventListener('visibilitychange',resume);
      window.removeEventListener('online',resume);
      window.removeEventListener('offline',suspend);
      window.removeEventListener('pagehide',suspend);
      window.removeEventListener('pageshow',resume);
    };
  },[enabled]);
  return {status:enabled?status:'disabled'} as const;
}
