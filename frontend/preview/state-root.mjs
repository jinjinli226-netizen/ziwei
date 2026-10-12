import path from 'node:path';
import fs from 'node:fs';
export function previewStateDirectory(root,env=process.env){
  const directory=path.resolve(env.ZIWEI_PREVIEW_DATA_ROOT||path.join(root,'.local/bot-preview'));
  if(path.basename(directory)!=='bot-preview'||path.basename(path.dirname(directory))!=='.local')throw new Error('Preview state must be an owned .local/bot-preview directory');
  if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw new Error('Preview state directory cannot be a link');
  return directory;
}
