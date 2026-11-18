import * as assert from "node:assert/strict";
import test from "node:test";
import { GalleryCardSelection } from "../src/features/gallery/galleryCardSelection";

class Card {
  dataset: { id: string };
  selected = false;
  attributes = new Map<string, string>();
  classList = {
    toggle: (_name: string, selected: boolean) => (this.selected = selected),
  };

  constructor(id: string) {
    this.dataset = { id };
  }

  closest() {
    return this;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

function fixture() {
  const cards = [new Card("first"), new Card("second")];
  const grid = {
    contains: (card: Card) => cards.includes(card),
    querySelectorAll: () => cards.filter((card) => card.selected),
  };
  return {
    cards,
    selection: new GalleryCardSelection(grid as unknown as HTMLElement),
  };
}

const target = (element: object) => element as EventTarget;

test("selects a card through its image or menu button and replaces the prior selection", () => {
  const { cards, selection } = fixture();
  selection.selectTarget(target({ closest: () => cards[0] }));
  assert.equal(cards[0].selected, true);
  assert.equal(cards[0].attributes.get("aria-pressed"), "true");
  selection.selectTarget(target({ closest: () => cards[1] }));
  assert.equal(cards[0].selected, false);
  assert.equal(cards[0].attributes.get("aria-pressed"), "false");
  assert.equal(cards[1].selected, true);
});

test("menu focus and right-clicking outside the grid preserve the current selection", () => {
  const { cards, selection } = fixture();
  selection.selectTarget(target(cards[0]));
  selection.selectTarget(target(cards[0]));
  selection.selectTarget(target(new Card("outside")));
  selection.selectTarget(target({}));
  selection.selectTarget(null);
  assert.equal(cards[0].selected, true);
  assert.equal(cards[1].selected, false);
});

test("restores selection after layout changes and clears results removed by filtering", () => {
  const { cards, selection } = fixture();
  selection.selectTarget(target(cards[0]));
  const replacement = new Card("first");
  selection.restore(replacement as unknown as HTMLElement);
  assert.equal(replacement.selected, true);
  const other = new Card("second");
  selection.restore(other as unknown as HTMLElement);
  assert.equal(other.selected, false);
  selection.retain(new Set(["first", "second"]));
  assert.equal(cards[0].selected, true);
  selection.retain(new Set(["second"]));
  assert.equal(cards[0].selected, false);
  selection.restore(replacement as unknown as HTMLElement);
  assert.equal(replacement.selected, false);
});
