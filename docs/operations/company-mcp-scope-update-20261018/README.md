# Company MCP scope update, 2026-10-18

This directory preserves the reviewed source for one authorized Company-device update. These files were prepared and tested locally; this record does not claim Windows execution or task registration.

The fixed task name is `Ziwei.TK.Scope.Update.20261018`. Registration is CREATE-only, current-user InteractiveToken/Limited, with one trigger and no immediate Run or automatic retry. It reads the previous successful 74e Plan and archive, freshly verifies the current 88 installation and process, and writes a separate job. Historical state, receipts, and prior archives are preserved. Only the freshly verified idle daemon root may be stopped using a held process handle. This does not settle an old business action or prove its process tree exited.

The source build is `88b2ea9f41c10c53498ecb524ad1dc5d836813440f804a61050f0e98da9cc14e`. The official target is commit `acee34d32f04167038cb1b55eab2377c142df614`, build `5a642107fa32d8e8f09ea139a9f964e7f50c77d9648788ae5aba6e96ac509fec`. Package/bootstrap pins, helper hashes, and byte lengths are in `artifacts.json`. The registration entry embeds byte-identical copies of the readable worker and two helpers.

`build-entry.py` validates a supplied official client manifest and adjacent package/bootstrap files, then renders into a new direct-child output directory. The `.in` files preserve its unfrozen templates; the five primary source files retain the actual frozen target. Existing outputs are refused. Do not edit a frozen entry independently of its readable helpers and manifest.

Local checks: `node --test docs/operations/company-mcp-scope-update-20261018/owned-idle-stop.test.mjs docs/operations/company-mcp-scope-update-20261018/scope-update-entry.test.mjs` and `python3 docs/operations/company-mcp-scope-update-20261018/local-freezer-check.py`. These checks use local files, synthetic state, and stdin only. The Mac has no native Windows PowerShell runtime, so these results do not claim COM or Windows process validation.

OAuth scope preservation applies to a new native authorization request. An explicitly narrower cached grant is retained and refused with `MCP_OAUTH_SCOPE_NOT_GRANTED`; repeated connection attempts do not upgrade it. An unknown grant scope is not reported as scope-confirmed. This update does not add a cache bypass or trusted reauthorization entry.
