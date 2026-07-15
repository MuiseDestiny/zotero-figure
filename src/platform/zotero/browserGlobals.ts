export type CloneIntoBrowserRealm = <T>(value: T, target: object) => T;

export interface BlobURLRealm {
  Blob: typeof Blob;
  URL: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
}

export interface RevocableBlobURL {
  readonly url: string;
  release(): void;
}

/**
 * Blob consumes its parts as an iterable. Clone those parts into the browser
 * realm first so Firefox never reads Symbol.iterator through a compartment
 * wrapper.
 */
export function createRealmSafeBlobConstructor(
  nativeBlob: typeof Blob,
  target: object,
  cloneInto: CloneIntoBrowserRealm,
): typeof Blob {
  function RealmSafeBlob(
    blobParts: BlobPart[] = [],
    options?: BlobPropertyBag,
  ): Blob {
    if (!new.target) {
      throw new TypeError("Blob constructor must be called with 'new'");
    }
    const targetParts = cloneInto(blobParts, target);
    const targetOptions =
      options === undefined ? undefined : cloneInto(options, target);
    return Reflect.construct(nativeBlob, [targetParts, targetOptions]) as Blob;
  }

  Object.setPrototypeOf(RealmSafeBlob, nativeBlob);
  Object.defineProperty(RealmSafeBlob, "prototype", {
    value: nativeBlob.prototype,
    writable: false,
  });
  return RealmSafeBlob as unknown as typeof Blob;
}

/**
 * Create an object URL owned by the document that will consume it. Firefox
 * associates blob URLs with their creator's principal, so a URL created by
 * Zotero's chrome window cannot be loaded by the resource:// reader document.
 */
export function createDocumentBlobURL(
  document: Document,
  blobParts: BlobPart[],
  options?: BlobPropertyBag,
): RevocableBlobURL {
  const realm = document.defaultView;
  if (!realm) {
    throw new Error("Cannot create an object URL for a detached document");
  }
  return createBlobURLInRealm(realm, blobParts, options, cloneIntoBrowserRealm);
}

export function createBlobURLInRealm(
  realm: BlobURLRealm,
  blobParts: BlobPart[],
  options: BlobPropertyBag | undefined,
  cloneInto: CloneIntoBrowserRealm,
): RevocableBlobURL {
  const BlobConstructor = createRealmSafeBlobConstructor(
    realm.Blob,
    realm,
    cloneInto,
  );
  const blob = new BlobConstructor(blobParts, options);
  const url = realm.URL.createObjectURL(blob);
  let released = false;
  return {
    url,
    release() {
      if (released) return;
      released = true;
      realm.URL.revokeObjectURL(url);
    },
  };
}

function cloneIntoBrowserRealm<T>(value: T, target: object): T {
  return Components.utils.cloneInto(value, target);
}
