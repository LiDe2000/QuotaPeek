use super::*;
use serde_json::json;

#[test]
fn frontend_geometry_payload_preserves_physical_coordinates_and_clip() {
    let bounds: WindowBounds = serde_json::from_value(json!({
        "x": -948, "y": 80, "width": 948, "height": 2080,
        "clipLeft": 792, "visibleWidth": 156, "visibleHeight": 600,
        "sourceX": -948, "sourceY": 80
    }))
    .unwrap();
    assert_eq!((bounds.x, bounds.y), (-948, 80));
    assert_eq!((bounds.width, bounds.height), (948, 2080));
    assert_eq!((bounds.clip_left, bounds.visible_width), (792, 156));
    assert_eq!(bounds.visible_height, Some(600));
    assert_eq!((bounds.source_x, bounds.source_y), (-948, 80));
}

#[test]
fn geometry_without_visible_height_keeps_full_height_fallback() {
    let bounds: WindowBounds = serde_json::from_value(json!({
        "x": 0, "y": 80, "width": 156, "height": 600,
        "clipLeft": 0, "visibleWidth": 156, "sourceX": 0, "sourceY": 80
    }))
    .unwrap();
    assert_eq!(bounds.visible_height.unwrap_or(bounds.height), 600);
}
