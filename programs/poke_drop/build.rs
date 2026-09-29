fn main() {
    println!("cargo:rerun-if-env-changed=POKEPACKS_DEPLOY");
    // scripts/deploy-devnet.sh exports POKEPACKS_DEPLOY=1 so a mock build
    // fails with the compile_error in lib.rs instead of producing a .so.
    if std::env::var("POKEPACKS_DEPLOY").ok().as_deref() == Some("1") {
        println!("cargo:rustc-cfg=poke_deploy");
    }
}
