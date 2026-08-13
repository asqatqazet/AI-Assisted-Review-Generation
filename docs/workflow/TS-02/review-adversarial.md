# TS-02 adversarial review

The initial file looked comprehensive but contained two false assurances: a cross-regex `$1` that
was never interpolated, and required edges for files that did not exist. It also barred Context from
the Admission seam accepted during design while leaving Admission reachable from execution persistence.

All findings were accepted. The rule set now uses explicit deployable pairs, disjoint DB adapter rules,
sealed exports, and independent compile/lint gates for global I/O. The violation transcript demonstrates
behavior rather than treating configuration text as evidence.

