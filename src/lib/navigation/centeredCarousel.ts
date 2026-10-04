export function carouselNext(index: number, direction: number, count: number) {
  return count ? ((index + direction) % count + count) % count : -1;
}

export function carouselOffset(index: number, selected: number, count: number) {
  const offset = carouselNext(index - selected, 0, count);
  return offset > Math.floor(count / 2) ? offset - count : offset;
}
