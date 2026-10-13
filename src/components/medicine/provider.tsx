'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {emptyMedicine,type MedicineCommand,type MedicineState} from '@/lib/medicine';

type MedicineContextValue={state:MedicineState;loading:boolean;busy:boolean;error:string;refresh:()=>Promise<void>;save:(type:MedicineCommand['type'],payload:Record<string,unknown>)=>Promise<boolean>};
const Context=createContext<MedicineContextValue|null>(null);
export function useMedicine(){const value=useContext(Context);if(!value)throw new Error('MedicineProvider gerekli.');return value;}
export function MedicineProvider({enabled,refreshRevision=0,children}:{enabled:boolean;refreshRevision?:number;children:ReactNode}){
 const [state,setState]=useState(emptyMedicine),[loading,setLoading]=useState(enabled),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(false),epoch=useRef(0),identities=useRef(new Map<string,string>());
 const refresh=useCallback(async()=>{
  if(!enabled)return;
  const revision=++epoch.current;
  setLoading(true);
  try{
   const response=await fetch('/api/medicine',{cache:'no-store'}),body=await response.json();
   if(!response.ok)throw new Error(body.error?.message??'Tıp kayıtları yüklenemedi.');
   if(epoch.current===revision){setState(body);setError('');}
  }catch(cause){if(epoch.current===revision)setError(cause instanceof Error?cause.message:'Tıp kayıtları yüklenemedi.');}
  finally{if(epoch.current===revision)setLoading(false);}
 },[enabled]);
 useEffect(()=>{
  // A mount starts external I/O; state changes happen after the response.
  let mounted=true;
  queueMicrotask(()=>{if(mounted&&enabled)void refresh();});
  const clock=epoch;
  return()=>{mounted=false;clock.current++;};
 },[enabled,refresh,refreshRevision]);
 const save=async(type:MedicineCommand['type'],payload:Record<string,unknown>)=>{
  if(pending.current||!enabled)return false;
  pending.current=true;setBusy(true);setError('');epoch.current++;
  const key=JSON.stringify({type,payload}),request_id=identities.current.get(key)??crypto.randomUUID();
  identities.current.set(key,request_id);
  try{
   const response=await fetch('/api/medicine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id,type,payload})}),body=await response.json();
   if(!response.ok){
    if(response.status<500)identities.current.delete(key);
    if(response.status===409){await refresh();setError(body.error?.message??'Kayıt değişti. Tekrar deneyin.');return false;}
    throw new Error(body.error?.message??'Tıp kaydı saklanamadı.');
   }
   setState(body.state);identities.current.delete(key);return true;
  }catch(cause){setError(cause instanceof Error?cause.message:'Bağlantı kurulamadı. Aynı kaydı yeniden deneyebilirsin.');return false;}
  finally{pending.current=false;setBusy(false);setLoading(false);}
 };
 return <Context value={{state,loading,busy,error,refresh,save}}>{children}</Context>;
}
