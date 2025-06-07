declare module 'anki-apkg-parser' {
  export class Unpack {
    constructor();
    unpack(source: string, destination: string): Promise<void>;
  }

  export class Deck {
    constructor(path: string);
    dbOpen(): Promise<any>;
  }
}
