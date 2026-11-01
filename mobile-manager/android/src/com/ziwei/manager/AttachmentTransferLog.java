package com.ziwei.manager;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Private metadata only; no filenames, paths, credentials or file content. */
final class AttachmentTransferLog {
    static synchronized void append(File directory,String event,long bytes){
        if(!event.matches("[a-z_]{1,40}")||bytes<0)return;
        try{
            File log=new File(directory,"attachment-transfers.jsonl"),previous=new File(directory,"attachment-transfers.previous.jsonl");
            if(log.length()>512*1024){if(previous.exists()&&!previous.delete())return;if(!log.renameTo(previous))return;}
            String line="{\"timeMs\":"+System.currentTimeMillis()+",\"event\":\""+event+"\",\"bytes\":"+bytes+"}\n";
            try(FileOutputStream output=new FileOutputStream(log,true)){output.write(line.getBytes(StandardCharsets.UTF_8));}
        }catch(Exception ignored){ }
    }
}
