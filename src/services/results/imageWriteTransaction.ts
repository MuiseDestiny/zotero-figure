export interface ImageWriteTransactionIO<RecordType> {
  getKey(record: RecordType): string;
  read(record: RecordType): Promise<ArrayBuffer | undefined>;
  remove(record: RecordType): Promise<void>;
  write(record: RecordType, image: ArrayBuffer): Promise<void>;
}

interface ImageBackup<RecordType> {
  image: ArrayBuffer | undefined;
  record: RecordType;
}

/** Tracks image writes until their owning manifest has been committed. */
export class ImageWriteTransaction<RecordType> {
  private readonly backups = new Map<string, ImageBackup<RecordType>>();
  private readonly created = new Map<string, RecordType>();
  private finished = false;

  constructor(private readonly io: ImageWriteTransactionIO<RecordType>) {}

  public trackCreated(record: RecordType): void {
    this.assertActive();
    const key = this.io.getKey(record);
    if (!this.backups.has(key)) this.created.set(key, record);
  }

  public async captureBeforeOverwrite(record: RecordType): Promise<void> {
    this.assertActive();
    const key = this.io.getKey(record);
    if (this.backups.has(key) || this.created.has(key)) return;
    this.backups.set(key, {
      image: await this.io.read(record),
      record,
    });
  }

  public commit(): void {
    this.assertActive();
    this.finished = true;
    this.backups.clear();
    this.created.clear();
  }

  public async rollback(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    const errors: Error[] = [];

    for (const record of this.created.values()) {
      try {
        await this.io.remove(record);
      } catch (error) {
        errors.push(toError(error));
      }
    }
    for (const { image, record } of this.backups.values()) {
      try {
        if (image !== undefined) await this.io.write(record, image);
        else await this.io.remove(record);
      } catch (error) {
        errors.push(toError(error));
      }
    }

    this.backups.clear();
    this.created.clear();
    if (errors.length > 0) {
      throw new Error(
        `Unable to roll back ${errors.length} figure result image write(s): ${errors
          .map(({ message }) => message)
          .join("; ")}`,
      );
    }
  }

  private assertActive(): void {
    if (this.finished) throw new Error("Figure result image transaction ended");
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
