// Executed by the phone runtime with the installed APK as the base.
(function () {
    var patchFile = new java.io.File(args.patch);
    var destination = new java.io.File(args.path);
    var temporary = new java.io.File(args.path + ".reconstructing");
    var base, patch, output;
    var count = 0;
    var digest = java.security.MessageDigest.getInstance("SHA-256");
    var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 262144);
    try {
        base = new java.io.RandomAccessFile(context.getApplicationInfo().sourceDir, "r");
        patch = new java.io.DataInputStream(new java.util.zip.GZIPInputStream(
            new java.io.BufferedInputStream(new java.io.FileInputStream(patchFile))));
        output = new java.io.FileOutputStream(temporary);
        if (patch.readInt() !== 0x41435431) throw Error("Unknown APK delta format");
        var opcode;
        while ((opcode = patch.readUnsignedByte()) !== 0) {
            if (opcode !== 1 && opcode !== 2) throw Error("Invalid APK delta command");
            var size = patch.readInt();
            if (size <= 0 || size > args.targetBytes - count) throw Error("Invalid APK delta length");
            if (opcode === 2) {
                var offset = patch.readInt();
                if (offset < 0 || offset + size > base.length()) throw Error("Invalid APK delta offset");
                base.seek(offset);
            }
            count += size;
            while (size > 0) {
                if (aict.isCancelled()) throw Error("APK delta cancelled");
                var length = Math.min(size, buffer.length);
                (opcode === 1 ? patch : base).readFully(buffer, 0, length);
                output.write(buffer, 0, length);
                digest.update(buffer, 0, length);
                size -= length;
            }
        }
        if (count !== args.targetBytes || patch.read() !== -1) throw Error("Invalid APK delta output size");
        output.close();
        output = null;
        var bytes = digest.digest(), hex = "";
        for (var i = 0; i < bytes.length; i++) {
            var part = (bytes[i] & 255).toString(16);
            hex += (part.length === 1 ? "0" : "") + part;
        }
        if (hex !== args.sha256) throw Error("Reconstructed APK hash mismatch");
        if (!temporary.renameTo(destination)) throw Error("Cannot store reconstructed APK");
        return {sha256: hex};
    } finally {
        if (output) output.close();
        if (patch) patch.close();
        if (base) base.close();
        temporary.delete();
        patchFile.delete();
    }
})();
