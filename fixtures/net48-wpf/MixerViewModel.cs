using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using System.Windows.Media;

namespace Swatches
{
    /// <summary>The colour being mixed, and the swatches saved so far, which the windows bind to.</summary>
    public class MixerViewModel : INotifyPropertyChanged
    {
        private int red = 0x2E;
        private int green = 0x7D;
        private int blue = 0x32;
        private string name = string.Empty;

        public MixerViewModel()
        {
            Saved = new ObservableCollection<Swatch>
            {
                new Swatch("Ink", Color.FromRgb(0x26, 0x32, 0x38)),
                new Swatch("Paper", Color.FromRgb(0xFA, 0xFA, 0xFA)),
            };
            SaveCommand = new RelayCommand(Save, () => !string.IsNullOrWhiteSpace(Name));
        }

        public event PropertyChangedEventHandler PropertyChanged;

        public int Red
        {
            get { return red; }
            set { SetChannel(ref red, value); }
        }

        public int Green
        {
            get { return green; }
            set { SetChannel(ref green, value); }
        }

        public int Blue
        {
            get { return blue; }
            set { SetChannel(ref blue, value); }
        }

        public Color Color
        {
            get { return Color.FromRgb((byte)red, (byte)green, (byte)blue); }
        }

        public string Hex
        {
            get { return string.Format("#{0:X2}{1:X2}{2:X2}", red, green, blue); }
        }

        /// <summary>Whether white text reads better than ink on the colour.</summary>
        public bool IsDark
        {
            get { return (299 * red + 587 * green + 114 * blue) / 1000 < 128; }
        }

        public string Name
        {
            get { return name; }
            set
            {
                if (name != value)
                {
                    name = value;
                    OnPropertyChanged();
                }
            }
        }

        public ObservableCollection<Swatch> Saved { get; private set; }

        public ICommand SaveCommand { get; private set; }

        private void Save()
        {
            Saved.Add(new Swatch(Name.Trim(), Color));
            Name = string.Empty;
        }

        private void SetChannel(ref int channel, int value)
        {
            if (value < 0 || value > 255)
            {
                value = value < 0 ? 0 : 255;
            }

            if (channel == value)
            {
                return;
            }

            channel = value;
            OnPropertyChanged(nameof(Red));
            OnPropertyChanged(nameof(Green));
            OnPropertyChanged(nameof(Blue));
            OnPropertyChanged(nameof(Color));
            OnPropertyChanged(nameof(Hex));
            OnPropertyChanged(nameof(IsDark));
        }

        private void OnPropertyChanged([CallerMemberName] string propertyName = null)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }
    }
}
