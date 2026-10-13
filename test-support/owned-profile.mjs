// Server unit fixtures only. Actual native provisioning is exercised separately.
import path from 'node:path';
export function completeOwnedProfile(repo,bot){
  if(bot.instance?.mode!=='owned_profile')return bot;
  const action=repo.getA2AAction(bot.instance.provisioning.actionId);
  if(action.status==='succeeded')return bot;
  const home=path.resolve('fixture-profile-root','profiles',bot.instance.profile);
  repo.ackA2AAction(action.id,{deviceId:bot.employee.target_device_id});
  repo.resultA2AAction(action.id,{deviceId:bot.employee.target_device_id,status:'succeeded',result:{botProvision:{schemaVersion:1,mode:'owned_profile',workspace:bot.workspace,employeeId:bot.id,deviceId:bot.employee.target_device_id,profile:bot.instance.profile,ownershipId:bot.instance.ownershipId,templateProfile:bot.instance.templateProfile,provisionActionId:bot.instance.provisionActionId,authMode:'source-native-store',home,profileHome:home,authentication:'configured',nativeVersion:'0.21.3'},processExit:{launched:true,rootPid:1,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false}}});
  return bot;
}
