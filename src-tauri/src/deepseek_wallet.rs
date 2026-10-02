//! Exact bounded decimal arithmetic for account-wallet amounts, including negative debt.
#[derive(Clone, Copy)]
pub struct Decimal {
    value: i128,
    scale: u32,
}
impl Decimal {
    pub fn parse(input: &str) -> Option<Self> {
        if input.is_empty() || input.len() > 80 {
            return None;
        }
        let (base, exponent) = match input.find(['e', 'E']) {
            Some(index) => (&input[..index], input[index + 1..].parse::<i32>().ok()?),
            None => (input, 0),
        };
        let (negative, base) = match base.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, base),
        };
        let parts: Vec<_> = base.split('.').collect();
        if parts.len() > 2 {
            return None;
        }
        let fraction = parts.get(1).copied().unwrap_or("");
        let digits = format!("{}{}", parts[0], fraction);
        if digits.is_empty() || !digits.bytes().all(|ch| ch.is_ascii_digit()) {
            return None;
        }
        let mut value = digits.parse::<i128>().ok()?;
        if negative {
            value = value.checked_neg()?;
        }
        let scale = i32::try_from(fraction.len()).ok()?.checked_sub(exponent)?;
        if !(-32..=32).contains(&scale) {
            return None;
        }
        if scale < 0 {
            value = value.checked_mul(10_i128.checked_pow((-scale) as u32)?)?;
        }
        Some(Self {
            value,
            scale: scale.max(0) as u32,
        })
    }
    pub fn add(self, other: Self) -> Option<Self> {
        let scale = self.scale.max(other.scale);
        let left = self
            .value
            .checked_mul(10_i128.checked_pow(scale - self.scale)?)?;
        let right = other
            .value
            .checked_mul(10_i128.checked_pow(scale - other.scale)?)?;
        Some(Self {
            value: left.checked_add(right)?,
            scale,
        })
    }
    pub fn positive(self) -> bool {
        self.value > 0
    }
    pub fn text(self) -> String {
        let digits = self.value.unsigned_abs().to_string();
        let mut body = if self.scale == 0 {
            digits
        } else {
            let padded = format!("{:0>width$}", digits, width = self.scale as usize + 1);
            let split = padded.len() - self.scale as usize;
            format!("{}.{}", &padded[..split], &padded[split..])
        };
        if self.scale > 0 {
            body = body.trim_end_matches('0').trim_end_matches('.').to_owned();
        }
        if self.value < 0 {
            format!("-{body}")
        } else {
            body
        }
    }
}
#[cfg(test)]
mod tests {
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
}
