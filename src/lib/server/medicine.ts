import {medicineCommandSchema, type MedicineState} from '../medicine';
import {requireEducationUser} from './education';
import {databaseError} from './service';
import {ApiError} from './http';
import type {SupabaseClient} from '@supabase/supabase-js';

export async function getMedicine(client:SupabaseClient):Promise<MedicineState>{
 const {data,error}=await client.rpc('medicine_state');
 if(error)databaseError(error);
 return data as MedicineState;
}
export async function medicineContext(){return requireEducationUser();}
export async function executeMedicineCommand(client:SupabaseClient,input:unknown){
 const parsed=medicineCommandSchema.safeParse(input);
 if(!parsed.success)throw new ApiError(400,'INVALID_INPUT',parsed.error.issues[0]?.message??'Alanları kontrol edin.');
 const {data,error}=await client.rpc('medicine_command',{request_id:parsed.data.request_id,command_type:parsed.data.type,payload:parsed.data.payload});
 if(error)databaseError(error);
 return {ok:true,result:data,state:await getMedicine(client)};
}
