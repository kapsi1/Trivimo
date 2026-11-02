// Kotlin 2.0's IntelliJ runtime cannot parse the version string of the local JDK 25.
public class KotlinCompilerLauncher {
    public static void main(String[] args) throws Exception {
        System.setProperty("java.version", "21");
        org.jetbrains.kotlin.cli.jvm.K2JVMCompiler.main(args);
    }
}
