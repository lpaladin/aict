import dev.aict.container.HttpTransfer;
import com.sun.net.httpserver.*;
import java.net.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.*;

public final class HttpTransferTest {
    static byte[] bytes=new byte[500000];
    static class Session implements HttpTransfer.Session {
        String cookie; boolean cancel;long progress;
        public String cookies(String url){return cookie;}
        public void setCookie(String url,String value){cookie=value.split(";",2)[0];}
        public void progress(long current,long total){progress=current;}
        public boolean cancelled(){return cancel;}
    }
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static void body(HttpExchange ex,int code,byte[] data)throws IOException{ex.sendResponseHeaders(code,data.length);try(OutputStream out=ex.getResponseBody()){out.write(data);}}
    public static void main(String[] args)throws Exception{
        for(int i=0;i<bytes.length;i++)bytes[i]=(byte)(i%251);
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        HttpServer other=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        AtomicBoolean rangeSeen=new AtomicBoolean(),changed=new AtomicBoolean();
        server.createContext("/redirect",ex->{ex.getResponseHeaders().add("Set-Cookie","session=ok; Path=/");ex.getResponseHeaders().add("Location","/cookie");ex.sendResponseHeaders(302,-1);ex.close();});
        server.createContext("/cookie",ex->{if(!"session=ok".equals(ex.getRequestHeaders().getFirst("Cookie"))){body(ex,403,new byte[]{0});return;}body(ex,200,bytes);});
        server.createContext("/file",ex->{
            String range=ex.getRequestHeaders().getFirst("Range"),ifRange=ex.getRequestHeaders().getFirst("If-Range");
            ex.getResponseHeaders().add("ETag",changed.get()?"\"new\"":"\"stable\"");
            if(range!=null&&!changed.get()){
                rangeSeen.set(true);check("\"stable\"".equals(ifRange),"If-Range missing");
                int start=Integer.parseInt(range.substring(6,range.length()-1));
                if(start==bytes.length){ex.getResponseHeaders().add("Content-Range","bytes */"+bytes.length);ex.sendResponseHeaders(416,-1);ex.close();return;}
                ex.getResponseHeaders().add("Content-Range","bytes "+start+"-"+(bytes.length-1)+"/"+bytes.length);
                body(ex,206,Arrays.copyOfRange(bytes,start,bytes.length));
            }else body(ex,200,bytes);
        });
        server.createContext("/bad",ex->{ex.getResponseHeaders().add("Content-Range","bytes 999-1000/1001");body(ex,206,new byte[]{1,2});});
        server.createContext("/stream",ex->{ex.sendResponseHeaders(200,0);try(OutputStream out=ex.getResponseBody()){out.write(bytes);}});
        server.createContext("/loop",ex->{ex.getResponseHeaders().add("Location","/loop");ex.sendResponseHeaders(302,-1);ex.close();});
        other.createContext("/auth",ex->{check(ex.getRequestHeaders().getFirst("Authorization")==null,"Authorization leaked across origin");body(ex,200,bytes);});
        server.createContext("/cross",ex->{ex.getResponseHeaders().add("Location","http://127.0.0.1:"+other.getAddress().getPort()+"/auth");ex.sendResponseHeaders(302,-1);ex.close();});
        server.start();other.start();
        Path dir=Paths.get(".build/transfer-tests");Files.createDirectories(dir);
        String base="http://127.0.0.1:"+server.getAddress().getPort();
        try{
            File file=dir.resolve("redirect.bin").toFile();Session session=new Session();
            HttpTransfer.fetch(base+"/redirect",file,Proxy.NO_PROXY,Collections.emptyMap(),session);
            check(Arrays.equals(bytes,Files.readAllBytes(file.toPath())),"Redirect/cookie body mismatch");
            System.out.println("PASS: relative redirects and cookies");
            file=dir.resolve("resume.bin").toFile();
            if(file.exists())file.delete();new File(file+".http-resume").delete();
            Session interrupted=new Session(){public void progress(long n,long total){super.progress(n,total);cancel=true;}};
            try{HttpTransfer.fetch(base+"/file",file,Proxy.NO_PROXY,Collections.emptyMap(),interrupted);throw new AssertionError("Cancel did not interrupt");}catch(InterruptedIOException expected){}
            check(file.length()>0&&file.length()<bytes.length,"No partial file");
            HttpTransfer.fetch(base+"/file",file,Proxy.NO_PROXY,Collections.emptyMap(),new Session());
            check(rangeSeen.get(),"No Range used");check(Arrays.equals(bytes,Files.readAllBytes(file.toPath())),"Resume corrupted bytes");
            System.out.println("PASS: cancellation, validator-backed Range resume and byte equality");
            seed(file,base+"/file",bytes.length,"\"stable\"");
            HttpTransfer.fetch(base+"/file",file,Proxy.NO_PROXY,Collections.emptyMap(),new Session());
            check(file.length()==bytes.length,"416 completion corrupted file");
            seed(file,base+"/file",1024,"\"stable\"");changed.set(true);
            HttpTransfer.fetch(base+"/file",file,Proxy.NO_PROXY,Collections.emptyMap(),new Session());
            check(Arrays.equals(bytes,Files.readAllBytes(file.toPath())),"Changed validator body was appended");
            System.out.println("PASS: 416 completion and server fallback to full replacement");
            HttpTransfer.fetch(base+"/stream",dir.resolve("stream.bin").toFile(),Proxy.NO_PROXY,Collections.emptyMap(),new Session());
            check(Arrays.equals(bytes,Files.readAllBytes(dir.resolve("stream.bin"))),"Chunked body mismatch");
            HttpTransfer.fetch(base+"/cross",dir.resolve("cross.bin").toFile(),Proxy.NO_PROXY,Collections.singletonMap("Authorization","Bearer secret"),new Session());
            System.out.println("PASS: chunked responses and cross-origin Authorization stripping");
            try{HttpTransfer.fetch(base+"/bad",dir.resolve("bad.bin").toFile(),Proxy.NO_PROXY,Collections.emptyMap(),new Session());throw new AssertionError("Bad range accepted");}catch(IOException expected){}
            try{HttpTransfer.fetch(base+"/loop",dir.resolve("loop.bin").toFile(),Proxy.NO_PROXY,Collections.emptyMap(),new Session());throw new AssertionError("Redirect loop accepted");}catch(IOException expected){}
            System.out.println("PASS: invalid range and redirect loop rejection");
        }finally{server.stop(0);other.stop(0);}
    }
    static void seed(File file,String source,int length,String validator)throws Exception{
        Files.write(file.toPath(),Arrays.copyOf(bytes,length));Properties p=new Properties();p.setProperty("source",source);p.setProperty("validator",validator);try(OutputStream out=new FileOutputStream(file+".http-resume")){p.store(out,"");}
    }
}
