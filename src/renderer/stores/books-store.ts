import { create } from 'zustand';

interface Book {
  id: number;
  title: string;
  isbn?: string;
  coverUrl?: string;
  pageCount?: number;
  materialCount?: number;
  selected: boolean;
  completed?: boolean;  // [Bug9] Already fully downloaded
}

interface BooksState {
  books: Book[];
  loading: boolean;
  error: string | null;
  completedBookIds: Set<number>;  // [Bug9]
  loadBooks: () => Promise<void>;
  checkCompletedBooks: (outputDir: string) => Promise<void>;  // [Bug9]
  toggleBook: (id: number) => void;
  selectAll: () => void;
  deselectAll: () => void;
  getSelectedIds: () => number[];
}

export const useBooksStore = create<BooksState>((set, get) => ({
  books: [],
  loading: false,
  error: null,
  completedBookIds: new Set(),

  loadBooks: async () => {
    set({ loading: true, error: null });
    try {
      const rawBooks = (await window.bibox.listBooks()) as Array<Record<string, unknown>>;
      const completedIds = get().completedBookIds;
      const books: Book[] = rawBooks.map((b) => ({
        id: Number(b.id),
        title: String(b.title || `Buch ${b.id}`),
        isbn: b.isbn ? String(b.isbn) : undefined,
        coverUrl: b.coverUrl ? String(b.coverUrl) : undefined,
        pageCount: b.pageCount ? Number(b.pageCount) : undefined,
        materialCount: b.materialCount ? Number(b.materialCount) : undefined,
        selected: false,
        completed: completedIds.has(Number(b.id)),
      }));

      set({ books, loading: false });

      // [M1/M2-FIX] Fetch accurate page counts from sync endpoint in background
      // (listBooks may return approximate counts; estimateSize uses the sync API for exact numbers)
      if (books.length > 0) {
        try {
          const estimates = (await window.bibox.estimateSize(
            books.map((b) => b.id)
          )) as Array<{ bookId: number; estimatedMB: number; pageCount: number }>;

          set((state) => ({
            books: state.books.map((book) => {
              const est = estimates.find((e) => e.bookId === book.id);
              return est && est.pageCount > 0
                ? { ...book, pageCount: est.pageCount ?? book.pageCount }
                : book;
            }),
          }));
        } catch {
          // Page count refinement is non-critical
        }
      }
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Bücher konnten nicht geladen werden',
      });
    }
  },

  // [Bug9] Check which books are already fully downloaded in the output directory
  checkCompletedBooks: async (outputDir: string) => {
    try {
      const completedIds = await window.bibox.checkCompletedBooks(outputDir);
      const completedSet = new Set(completedIds);
      set((state) => ({
        completedBookIds: completedSet,
        books: state.books.map((b) => ({
          ...b,
          completed: completedSet.has(b.id),
        })),
      }));
    } catch {
      // Non-critical
    }
  },

  toggleBook: (id) => {
    set((state) => ({
      books: state.books.map((b) => (b.id === id ? { ...b, selected: !b.selected } : b)),
    }));
  },

  selectAll: () => {
    set((state) => ({
      books: state.books.map((b) => ({ ...b, selected: true })),
    }));
  },

  deselectAll: () => {
    set((state) => ({
      books: state.books.map((b) => ({ ...b, selected: false })),
    }));
  },

  getSelectedIds: () => get().books.filter((b) => b.selected).map((b) => b.id),
}));
