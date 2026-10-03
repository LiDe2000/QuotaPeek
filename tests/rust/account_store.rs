use super::*;
#[test]
fn identities_are_unambiguous_and_do_not_depend_on_tokens() {
    assert_ne!(key("workbuddy", "cn:user"), key("workbuddy", "global:user"));
    assert_ne!(key("zcode", "zai:one"), key("zcode", "zai:two"));
    assert_eq!(key("zcode", "zai:one"), key("zcode", "zai:one"));
}
