export async function hydrateRosterEmployee({workspace,employee},{getWorkspace,fetchEmployees,isCurrent=()=>true}){
 if(!employee?.id||workspace!==getWorkspace())return null;
 const result=await fetchEmployees(workspace);
 if(workspace!==getWorkspace()||!isCurrent())return null;
 return (result.employees||[]).find(item=>item.id===employee.id)||null;
}
