using System;

namespace Kestrelwood.Checksums
{
    /// <summary>The Luhn check digit of card and account numbers.</summary>
    public static class Luhn
    {
        public const int Modulus = 10;

        /// <summary>The digit that, appended to <paramref name="digits"/>, makes a valid number.</summary>
        public static int CheckDigit(string digits) => (Modulus - Sum(digits, false) % Modulus) % Modulus;

        public static bool IsValid(string number) => number.Length > 1 && Sum(number, true) % Modulus == 0;

        private static int Sum(string digits, bool hasCheckDigit)
        {
            int sum = 0;
            for (int i = 0; i < digits.Length; i++)
            {
                char c = digits[digits.Length - 1 - i];
                if (c < '0' || c > '9')
                {
                    throw new InvalidDigitException(digits, digits.Length - 1 - i);
                }
                int digit = c - '0';
                if (i % 2 == (hasCheckDigit ? 1 : 0))
                {
                    digit *= 2;
                    if (digit > 9)
                    {
                        digit -= 9;
                    }
                }
                sum += digit;
            }
            return sum;
        }
    }

    public class InvalidDigitException : FormatException
    {
        public InvalidDigitException(string text, int position)
            : base($"'{text[position]}' at {position} is not a digit.")
        {
            Position = position;
        }

        public int Position { get; }
    }

    public static class ChecksumExtensions
    {
        /// <summary>The text with its checksum appended, as <c>text#hex</c>.</summary>
        public static string Tagged(this string text, IChecksum checksum) =>
            text + "#" + checksum.Compute(System.Text.Encoding.UTF8.GetBytes(text)).ToString("x8");
    }
}
