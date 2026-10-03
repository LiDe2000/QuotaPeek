use super::*;
#[test]
fn wallet_debt_and_promotional_credit_add_exactly() {
    assert_eq!(
        Decimal::parse("-0.02")
            .unwrap()
            .add(Decimal::parse("6.0000000000000000").unwrap())
            .unwrap()
            .text(),
        "5.98"
    );
    assert_eq!(Decimal::parse("0E-16").unwrap().text(), "0");
    assert_eq!(
        Decimal::parse(".1")
            .unwrap()
            .add(Decimal::parse(".2").unwrap())
            .unwrap()
            .text(),
        "0.3"
    );
    assert_eq!(Decimal::parse("1e+3").unwrap().text(), "1000");
}
#[test]
fn malformed_or_unbounded_amounts_fail_without_rounding() {
    for value in ["NaN", "Infinity", "1.2.3", "", "1e999", "--1", "+1", "e2"] {
        assert!(Decimal::parse(value).is_none());
    }
    assert!(!Decimal::parse("-1").unwrap().positive());
}
