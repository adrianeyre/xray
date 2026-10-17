using System;
using System.Text;
using ClassesStructs.Values;

namespace ClassesStructs;

/// <summary>A rectangular grid of cells, indexed by coordinates or by a Point.</summary>
public sealed class Grid
{
    private readonly char[,] cells;

    public Grid(int width, int height)
    {
        if (width < 1 || height < 1)
        {
            throw new FormatException($"A grid cannot be {width} x {height}.");
        }

        cells = new char[width, height];
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                cells[x, y] = '.';
            }
        }
    }

    public int Width => cells.GetLength(0);

    public int Height => cells.GetLength(1);

    public char this[int x, int y]
    {
        get => cells[x, y];
        set => cells[x, y] = value;
    }

    public char this[Point point]
    {
        get => this[point.X, point.Y];
        set => this[point.X, point.Y] = value;
    }

    public bool Contains(Point point) => point.X >= 0 && point.X < Width && point.Y >= 0 && point.Y < Height;

    public string Row(int y)
    {
        var row = new StringBuilder(Width);
        for (var x = 0; x < Width; x++)
        {
            row.Append(cells[x, y]);
        }

        return row.ToString();
    }

    /// <summary>A nested class, which reads its grid's private cells.</summary>
    public sealed class Cursor
    {
        private readonly Grid grid;

        public Cursor(Grid grid)
        {
            this.grid = grid;
        }

        public int Marked
        {
            get
            {
                var marked = 0;
                foreach (var cell in grid.cells)
                {
                    if (cell != '.')
                    {
                        marked++;
                    }
                }

                return marked;
            }
        }
    }
}
