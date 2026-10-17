namespace Greeter;

partial class MainForm
{
    /// <summary>
    ///  Required designer variable.
    /// </summary>
    private System.ComponentModel.IContainer components = null;

    /// <summary>
    ///  Clean up any resources being used.
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
    ///  Required method for Designer support - do not modify
    ///  the contents of this method with the code editor.
    /// </summary>
    private void InitializeComponent()
    {
        components = new System.ComponentModel.Container();
        System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(MainForm));
        logo = new PictureBox();
        nameLabel = new Label();
        nameBox = new TextBox();
        greetButton = new Button();
        greetingLabel = new Label();
        hints = new ToolTip(components);
        ((System.ComponentModel.ISupportInitialize)logo).BeginInit();
        SuspendLayout();
        // 
        // logo
        // 
        logo.Image = (Image)resources.GetObject("logo.Image");
        logo.Location = new Point(12, 12);
        logo.Name = "logo";
        logo.Size = new Size(48, 16);
        logo.SizeMode = PictureBoxSizeMode.AutoSize;
        logo.TabIndex = 0;
        logo.TabStop = false;
        // 
        // nameLabel
        // 
        nameLabel.AutoSize = true;
        nameLabel.Location = new Point(12, 40);
        nameLabel.Name = "nameLabel";
        nameLabel.Size = new Size(42, 15);
        nameLabel.TabIndex = 1;
        nameLabel.Text = "&Name:";
        // 
        // nameBox
        // 
        nameBox.Location = new Point(60, 37);
        nameBox.MaxLength = 60;
        nameBox.Name = "nameBox";
        nameBox.Size = new Size(180, 23);
        nameBox.TabIndex = 2;
        hints.SetToolTip(nameBox, "Up to 40 characters");
        nameBox.TextChanged += nameBox_TextChanged;
        // 
        // greetButton
        // 
        greetButton.Location = new Point(246, 36);
        greetButton.Name = "greetButton";
        greetButton.Size = new Size(75, 25);
        greetButton.TabIndex = 3;
        greetButton.Text = "&Greet";
        greetButton.UseVisualStyleBackColor = true;
        greetButton.Click += greetButton_Click;
        // 
        // greetingLabel
        // 
        greetingLabel.AutoSize = true;
        greetingLabel.Location = new Point(12, 72);
        greetingLabel.Name = "greetingLabel";
        greetingLabel.Size = new Size(0, 15);
        greetingLabel.TabIndex = 4;
        // 
        // MainForm
        // 
        AcceptButton = greetButton;
        AutoScaleDimensions = new SizeF(7F, 15F);
        AutoScaleMode = AutoScaleMode.Font;
        ClientSize = new Size(334, 101);
        Controls.Add(greetingLabel);
        Controls.Add(greetButton);
        Controls.Add(nameBox);
        Controls.Add(nameLabel);
        Controls.Add(logo);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        Icon = (Icon)resources.GetObject("$this.Icon");
        MaximizeBox = false;
        Name = "MainForm";
        StartPosition = FormStartPosition.CenterScreen;
        Text = "Greeter";
        ((System.ComponentModel.ISupportInitialize)logo).EndInit();
        ResumeLayout(false);
        PerformLayout();
    }

    #endregion

    private PictureBox logo;
    private Label nameLabel;
    private TextBox nameBox;
    private Button greetButton;
    private Label greetingLabel;
    private ToolTip hints;
}
