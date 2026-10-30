const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

export function dshGroupRoster(employees,subject){
 if(!subject)return[];
 const rows=employees.filter(employee=>employee.runtime==='DSH'&&employee.target_device_id===subject?.deviceId&&employee.runtime_profile&&employee.status!=='deleted').map(employee=>({employeeId:employee.id,profile:employee.runtime_profile,label:employee.name||employee.runtime_profile}));
 return rows.map(row=>({...row,ambiguous:row.profile!==subject.profile&&rows.filter(other=>other.profile===row.profile).length!==1||row.profile===subject.profile&&row.employeeId!==subject.employeeId}));
}
export function dshGroupItems(data,previous=[]){
 if(data?.items)return[...data.items];
 const rows=previous.filter(row=>row.id!==data?.deletedId);
 if(!data?.item)return rows;
 const index=rows.findIndex(row=>row.id===data.item.id);if(index<0)rows.push(data.item);else rows[index]=data.item;
 return rows;
}
export function dshGroupEditInput(draft,{groupId,subject,roster}){
 const title=draft.title.trim(),ids=[...draft.memberEmployeeIds];
 if(!title||title.length>480)throw Error('请填写 1–480 字的群名称。');
 if(ids.length<2||ids.length>6||new Set(ids).size!==ids.length)throw Error('请选择 2–6 位不同的群成员。');
 if(!ids.includes(subject.employeeId))throw Error('群成员必须包含当前员工。');
 const members=ids.map(id=>roster.find(row=>row.employeeId===id));if(members.some(row=>!row))throw Error('请选择当前设备上可见的 DSH 员工。');
 if(members.some(row=>row.ambiguous)||new Set(members.map(row=>row.profile)).size!==members.length)throw Error('成员的原生 Bot 映射不唯一，请先核对员工绑定。');
 return{...(groupId?{groupId}:{}),title,memberEmployeeIds:ids};
}
export function dshGroupSendInput(group,content,targetEmployeeIds,roster){
 if(!group)throw Error('请先选择已读取的原生群。');
 if(!content.trim()||content.length>16000)throw Error('请填写 1–16000 字的群消息。');
 if(targetEmployeeIds===null)return{groupId:group.id,content};
 if(!targetEmployeeIds.length)throw Error('请至少选择一位接收成员。');
 const targets=targetEmployeeIds.map(id=>roster.find(row=>row.employeeId===id));
 if(new Set(targetEmployeeIds).size!==targets.length||targets.some(row=>!row||row.ambiguous||!group.members.includes(row.profile)))throw Error('接收员工必须唯一且属于当前群。');
 return{groupId:group.id,content,targetEmployeeIds:[...targetEmployeeIds]};
}
export function dshGroupExecution(action,subject){
 const op=action?.payload?.dshOperation;if(op?.resource!=='groups'||op.scope?.kind!=='group'||!same(op.subject,subject)||!['send','cancel'].includes(op.operation))return null;
 const receipt=action.result?.dshNative;
 if(receipt&&(!same(receipt.subject,subject)||!same(receipt.scope,op.scope)||receipt.resource!=='groups'||receipt.operation!==op.operation))return null;
 return{actionId:action.id,actionStatus:action.status,started:Boolean(action.acked_at)||action.status==='acked'||Boolean(receipt),groupId:op.scope.groupId,operation:op.operation,status:receipt?.status||(['succeeded','failed','expired','cancelled'].includes(action.status)?'unknown':'pending'),sourceActionId:op.operation==='send'?action.id:receipt?.data?.sourceActionId||null,members:receipt?.data?.members||[],historyPersisted:receipt?.data?.historyPersisted===true,data:receipt?.data||{}};
}
