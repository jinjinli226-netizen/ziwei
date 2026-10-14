import path from 'node:path';

export const successfulProfileExit=exit=>exit?.launched===true&&exit.rootConfirmed===true&&exit.rootExitCode===0
  &&exit.treeConfirmed===true&&exit.activeProcesses===0&&exit.cancelled!==true&&!exit.failureCode&&!exit.signal
  &&(exit.hostExitCode===undefined||exit.hostExitCode===null||exit.hostExitCode===0);

// Shared by the device and server; never accept a directory-only success.
export function ownedProfileProofMatches(context,receipt,exit){
  const binding=context?.instance;
  const paths=path.posix.isAbsolute(receipt?.home || '')?path.posix:path.win32;
  return Boolean(binding?.mode==='owned_profile'&&receipt?.schemaVersion===1&&receipt.mode==='owned_profile'
    &&receipt.employeeId===context.employeeId&&receipt.workspace===context.workspace&&receipt.deviceId===context.deviceId
    &&receipt.profile===binding.profile&&receipt.ownershipId===binding.ownershipId
    &&receipt.templateProfile===binding.templateProfile&&receipt.provisionActionId===binding.provisionActionId
    &&receipt.home===receipt.profileHome&&typeof receipt.home==='string'&&paths.isAbsolute(receipt.home)
    &&paths.basename(receipt.home)===binding.profile&&paths.basename(paths.dirname(receipt.home))==='profiles'
    &&receipt.authMode==='source-native-store'&&['configured','required','source_reference'].includes(receipt.authentication)
    &&typeof receipt.nativeVersion==='string'&&receipt.nativeVersion.length>0&&successfulProfileExit(exit));
}
