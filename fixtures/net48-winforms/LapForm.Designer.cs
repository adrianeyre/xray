namespace Stopwatch
{
    partial class LapForm
    {
        /// <summary>
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows Form Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            this.components = new System.ComponentModel.Container();
            System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(LapForm));
            this.dial = new System.Windows.Forms.PictureBox();
            this.timeLabel = new System.Windows.Forms.Label();
            this.startButton = new System.Windows.Forms.Button();
            this.lapButton = new System.Windows.Forms.Button();
            this.lapList = new System.Windows.Forms.ListBox();
            this.ticker = new System.Windows.Forms.Timer(this.components);
            this.hints = new System.Windows.Forms.ToolTip(this.components);
            ((System.ComponentModel.ISupportInitialize)(this.dial)).BeginInit();
            this.SuspendLayout();
            // 
            // dial
            // 
            this.dial.Image = ((System.Drawing.Image)(resources.GetObject("dial.Image")));
            this.dial.Location = new System.Drawing.Point(12, 12);
            this.dial.Name = "dial";
            this.dial.Size = new System.Drawing.Size(32, 32);
            this.dial.SizeMode = System.Windows.Forms.PictureBoxSizeMode.AutoSize;
            this.dial.TabIndex = 0;
            this.dial.TabStop = false;
            // 
            // timeLabel
            // 
            this.timeLabel.Font = new System.Drawing.Font("Microsoft Sans Serif", 18F, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Point, ((byte)(0)));
            this.timeLabel.Location = new System.Drawing.Point(50, 12);
            this.timeLabel.Name = "timeLabel";
            this.timeLabel.Size = new System.Drawing.Size(130, 32);
            this.timeLabel.TabIndex = 1;
            this.timeLabel.TextAlign = System.Drawing.ContentAlignment.MiddleRight;
            // 
            // startButton
            // 
            this.startButton.Location = new System.Drawing.Point(12, 52);
            this.startButton.Name = "startButton";
            this.startButton.Size = new System.Drawing.Size(80, 25);
            this.startButton.TabIndex = 2;
            this.startButton.Text = "&Start";
            this.hints.SetToolTip(this.startButton, "Start or stop the stopwatch");
            this.startButton.UseVisualStyleBackColor = true;
            this.startButton.Click += new System.EventHandler(this.startButton_Click);
            // 
            // lapButton
            // 
            this.lapButton.Enabled = false;
            this.lapButton.Location = new System.Drawing.Point(100, 52);
            this.lapButton.Name = "lapButton";
            this.lapButton.Size = new System.Drawing.Size(80, 25);
            this.lapButton.TabIndex = 3;
            this.lapButton.Text = "&Lap";
            this.lapButton.UseVisualStyleBackColor = true;
            this.lapButton.Click += new System.EventHandler(this.lapButton_Click);
            // 
            // lapList
            // 
            this.lapList.FormattingEnabled = true;
            this.lapList.Location = new System.Drawing.Point(12, 85);
            this.lapList.Name = "lapList";
            this.lapList.Size = new System.Drawing.Size(168, 95);
            this.lapList.TabIndex = 4;
            // 
            // ticker
            // 
            this.ticker.Tick += new System.EventHandler(this.ticker_Tick);
            // 
            // LapForm
            // 
            this.AutoScaleDimensions = new System.Drawing.SizeF(6F, 13F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.ClientSize = new System.Drawing.Size(192, 192);
            this.Controls.Add(this.lapList);
            this.Controls.Add(this.lapButton);
            this.Controls.Add(this.startButton);
            this.Controls.Add(this.timeLabel);
            this.Controls.Add(this.dial);
            this.FormBorderStyle = System.Windows.Forms.FormBorderStyle.FixedSingle;
            this.Icon = ((System.Drawing.Icon)(resources.GetObject("$this.Icon")));
            this.MaximizeBox = false;
            this.Name = "LapForm";
            this.Text = "Stopwatch";
            ((System.ComponentModel.ISupportInitialize)(this.dial)).EndInit();
            this.ResumeLayout(false);
            this.PerformLayout();

        }

        #endregion

        private System.Windows.Forms.PictureBox dial;
        private System.Windows.Forms.Label timeLabel;
        private System.Windows.Forms.Button startButton;
        private System.Windows.Forms.Button lapButton;
        private System.Windows.Forms.ListBox lapList;
        private System.Windows.Forms.Timer ticker;
        private System.Windows.Forms.ToolTip hints;
    }
}
