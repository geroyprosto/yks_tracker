'use client';
import {createRealtime,RealtimeProvider} from '@upstash/realtime/client';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import type {StudyRealtimeEvents} from './realtime-schema';

const {useRealtime}=createRealtime<StudyRealtimeEvents>();
export function StudyRealtimeProvider({children}:{children:ReactNode}){
  return <RealtimeProvider api={{url:'/api/realtime',withCredentials:true}} maxReconnectAttempts={3}>{children}</RealtimeProvider>;
}

/** Realtime carries hints; the caller owns guarded/coalesced authoritative reads. */
export function useStudyRealtime({enabled,onDirty,onReconnect}:{enabled:boolean;onDirty:()=>void;onReconnect?:()=>void}){
  const [session,setSession]=useState<{channel:string|null;failed:boolean}>({channel:null,failed:false});
  const callbacks=useRef({onDirty,onReconnect});
  useEffect(()=>{callbacks.current={onDirty,onReconnect};},[onDirty,onReconnect]);
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();
    let sequence=0;
    const load=async()=>{
      const current=++sequence;
      try{
        const response=await fetch('/api/realtime?session=1',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
        const result=await response.json();
        if(controller.signal.aborted||current!==sequence)return;
        if(!response.ok){setSession({channel:null,failed:true});return;}
        const channel=result.enabled===true&&typeof result.channel==='string'&&/^yksim:study:v1:[0-9a-f]{64}$/.test(result.channel)?result.channel:null;
        setSession({channel,failed:false});
      }catch{if(!controller.signal.aborted&&current===sequence)setSession({channel:null,failed:true});}
    };
    void load();
    const retry=()=>{if(navigator.onLine)void load();};
    window.addEventListener('online',retry);
    return()=>{controller.abort();window.removeEventListener('online',retry);};
  },[enabled]);
  const onData=useCallback(()=>{callbacks.current.onDirty();},[]);
  const {status}=useRealtime({channels:enabled&&session.channel?[session.channel]:[],
    events:['study.dirty'],enabled:enabled&&Boolean(session.channel),onData});
  const previousStatus=useRef<string>('disconnected');
  useEffect(()=>{
    if(enabled&&session.channel&&status==='connected'&&previousStatus.current!=='connected')callbacks.current.onReconnect?.();
    previousStatus.current=enabled?status:'disconnected';
  },[enabled,session.channel,status]);
  return {status:!enabled?'disabled':session.failed?'error':session.channel?status:'disabled'} as const;
}
