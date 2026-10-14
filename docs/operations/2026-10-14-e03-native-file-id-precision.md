# Native file identity precision correction

The real default Windows dual-host source CLI refused stable native directories with SOURCE_DIRECTORY_CHANGED. `scanNativeFiles` recorded dev/ino using the default Number stat, while strict source recheck read the actual filesystem with bigint stat. On this machine an actual NTFS inode `19984723350203829` became `19984723350203828` through Number. No namespace, action debt or evidence policy caused that mismatch.

The correction is limited to `preservation-native-evidence.mjs` identity-producing reads: ordinary files, directory proofs and bot HOME markers use `fs.lstatSync(...,{bigint:true})`; their hardlink check uses `1n`. IDs remain decimal strings in the same manifest ABI. Symlink, hardlink, scope, legacy and debt rules are unchanged. The strict collector recheck remains unchanged.

`test/preservation-native-file-identity.test.mjs` creates an actual runtime with an empty durable action state, obtains the real native scanner manifest, and compares every existing file/directory identity with the full-width native IDs. The broader default two-host qualification uses genuine Windows original-process birth/paths, closed no-worker source programs, private client factory servers and native listener ownership. It is a synthetic qualification, not production runtime clearance.

The original actual two-host execution provided the red regression (SOURCE_DIRECTORY_CHANGED on unchanged native directories). The narrow ID regression and existing native evidence tests verify this correction without changing any business service or installed SDK. The client/native source implementation is separate from this precision commit.
