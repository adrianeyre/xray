using System;
using System.Windows.Forms;

namespace Stopwatch
{
    public partial class LapForm : Form
    {
        private int tenths;
        private int laps;

        public LapForm()
        {
            InitializeComponent();
            ShowTime();
        }

        private void ShowTime()
        {
            timeLabel.Text = string.Format("{0}:{1:00}.{2}", tenths / 600, tenths / 10 % 60, tenths % 10);
        }

        private void ticker_Tick(object sender, EventArgs e)
        {
            tenths++;
            ShowTime();
        }

        private void startButton_Click(object sender, EventArgs e)
        {
            ticker.Enabled = !ticker.Enabled;
            startButton.Text = ticker.Enabled ? "&Stop" : "&Start";
            lapButton.Enabled = ticker.Enabled;
        }

        private void lapButton_Click(object sender, EventArgs e)
        {
            laps++;
            lapList.Items.Insert(0, string.Format("Lap {0}: {1}", laps, timeLabel.Text));
        }
    }
}
