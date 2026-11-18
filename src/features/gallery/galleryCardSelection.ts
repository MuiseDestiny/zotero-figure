/** Selection belongs to a result, independently of focus moving into a menu. */
export class GalleryCardSelection {
  private selectedID?: string;

  constructor(private readonly grid: HTMLElement) {}

  public selectTarget(target: EventTarget | null): HTMLElement | undefined {
    const element = target as Element | null;
    const card = element?.closest?.<HTMLElement>(".gallery-card");
    if (!card || !this.grid.contains(card) || !card.dataset.id) return;
    this.selectedID = card.dataset.id;
    this.grid
      .querySelectorAll<HTMLElement>(".gallery-card.is-selected")
      .forEach((selected) => {
        if (selected !== card) this.setSelected(selected, false);
      });
    this.setSelected(card, true);
    return card;
  }

  public restore(card: HTMLElement): void {
    this.setSelected(card, card.dataset.id === this.selectedID);
  }

  public retain(visibleIDs: ReadonlySet<string>): void {
    if (this.selectedID && !visibleIDs.has(this.selectedID)) {
      this.selectedID = undefined;
      this.grid
        .querySelectorAll<HTMLElement>(".gallery-card.is-selected")
        .forEach((card) => this.setSelected(card, false));
    }
  }

  private setSelected(card: HTMLElement, selected: boolean): void {
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  }
}
