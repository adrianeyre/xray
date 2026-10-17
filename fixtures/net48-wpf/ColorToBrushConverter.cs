using System;
using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;

namespace Swatches
{
    /// <summary>Paints a <see cref="Color"/> as a frozen <see cref="SolidColorBrush"/>.</summary>
    [ValueConversion(typeof(Color), typeof(SolidColorBrush))]
    public class ColorToBrushConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (!(value is Color))
            {
                return Binding.DoNothing;
            }

            var brush = new SolidColorBrush((Color)value);
            brush.Freeze();
            return brush;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            var brush = value as SolidColorBrush;
            return brush != null ? (object)brush.Color : Binding.DoNothing;
        }
    }
}
